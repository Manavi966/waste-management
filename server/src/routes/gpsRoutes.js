const express = require("express");
const pool = require("../config/db");

const router = express.Router();

// Receive GPS location from driver's phone
router.post("/", async (req, res) => {
    try {
        const {
            vehicle_id,
            latitude,
            longitude,
            speed
        } = req.body;

        if (
            !vehicle_id ||
            latitude === undefined ||
            longitude === undefined
        ) {
            return res.status(400).json({
                message:
                    "vehicle_id, latitude and longitude are required"
            });
        }

        const result = await pool.query(
            `INSERT INTO gps_tracking
             (vehicle_id, latitude, longitude, speed, recorded_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             RETURNING *`,
            [
                vehicle_id,
                latitude,
                longitude,
                speed ?? 0
            ]
        );

        await pool.query(
            `UPDATE vehicles
             SET
                current_latitude = $1,
                current_longitude = $2
             WHERE id = $3`,
            [
                latitude,
                longitude,
                vehicle_id
            ]
        );

        // Geofence & Dwell Monitoring: check active route stop for this vehicle
        try {
            const todayStr = new Date().toISOString().split("T")[0];
            const activeStopRes = await pool.query(
                `SELECT rs.id, rs.status, rs.dwell_start_time, rs.verification_status,
                        cp.name, cp.latitude, cp.longitude,
                        COALESCE(cp.minimum_collection_time_seconds, 30) AS minimum_collection_time_seconds,
                        COALESCE(cp.geofence_radius_meters, 100) AS geofence_radius_meters,
                        v.vehicle_number
                 FROM route_stops rs
                 JOIN routes r ON rs.route_id = r.id
                 JOIN collection_points cp ON rs.collection_point_id = cp.id
                 JOIN vehicles v ON r.vehicle_id = v.id
                 WHERE r.vehicle_id = $1 AND r.route_date = $2::date AND rs.status != 'COMPLETED' AND rs.status != 'MISSED'
                 ORDER BY rs.sequence ASC
                 LIMIT 1`,
                [vehicle_id, todayStr]
            );

            if (activeStopRes.rows.length > 0) {
                const stop = activeStopRes.rows[0];
                const { calculateHaversineDistance } = require("../services/trafficService");
                const distKm = calculateHaversineDistance(
                    Number(latitude),
                    Number(longitude),
                    Number(stop.latitude),
                    Number(stop.longitude)
                );
                const distanceMeters = Math.round(distKm * 1000);
                const maxDistance = stop.geofence_radius_meters || 100;

                if (distanceMeters <= maxDistance) {
                    // Inside geofence
                    if (!stop.dwell_start_time) {
                        await pool.query(
                            `UPDATE route_stops 
                             SET dwell_start_time = CURRENT_TIMESTAMP, 
                                 actual_arrival = COALESCE(actual_arrival, CURRENT_TIMESTAMP), 
                                 last_gps_inside_at = CURRENT_TIMESTAMP,
                                 verification_status = 'IN_PROGRESS' 
                             WHERE id = $1`,
                            [stop.id]
                        );
                    } else {
                        await pool.query(
                            `UPDATE route_stops SET last_gps_inside_at = CURRENT_TIMESTAMP WHERE id = $1`,
                            [stop.id]
                        );
                    }
                } else if (stop.dwell_start_time) {
                    // Vehicle left geofence before completing
                    const elapsedSec = Math.floor((Date.now() - new Date(stop.dwell_start_time).getTime()) / 1000);
                    const minSec = Number(stop.minimum_collection_time_seconds) || 30;

                    if (elapsedSec < minSec) {
                        // Reset dwell timer because minimum duration was not satisfied
                        await pool.query(
                            `UPDATE route_stops 
                             SET dwell_start_time = NULL, 
                                 verification_status = 'DWELL_RESET' 
                             WHERE id = $1`,
                            [stop.id]
                        );

                        await pool.query(
                            `INSERT INTO activity_logs (event_type, description, vehicle_id)
                             VALUES ($1, $2, $3)`,
                            [
                                'DWELL_TIMER_RESET',
                                `Vehicle ${stop.vehicle_number} exited ${stop.name} (${distanceMeters}m away) before minimum collection time (${elapsedSec}s / ${minSec}s). Dwell timer reset.`,
                                vehicle_id
                            ]
                        );
                    }
                }
            }
        } catch (geoErr) {
            console.error("Geofence monitoring error:", geoErr);
        }

        res.json({
            message: "GPS location recorded successfully",
            location: result.rows[0]
        });

    } catch (error) {
        console.error("GPS tracking error:", error);

        res.status(500).json({
            message: "Failed to record GPS location"
        });
    }
});


// Get latest GPS location for a vehicle
router.get("/vehicle/:vehicleId", async (req, res) => {
    try {
        const { vehicleId } = req.params;

        const result = await pool.query(
            `SELECT
                gt.id,
                gt.vehicle_id,
                gt.latitude,
                gt.longitude,
                gt.speed,
                gt.recorded_at,
                v.vehicle_number
             FROM gps_tracking gt
             JOIN vehicles v
                ON gt.vehicle_id = v.id
             WHERE gt.vehicle_id = $1
             ORDER BY gt.recorded_at DESC
             LIMIT 1`,
            [vehicleId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "No GPS location found for this vehicle"
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error("GPS fetch error:", error);

        res.status(500).json({
            message: "Failed to fetch GPS location"
        });
    }
});

// Get latest GPS location of every vehicle
router.get("/latest", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT ON (gt.vehicle_id)
                gt.id,
                gt.vehicle_id,
                gt.latitude,
                gt.longitude,
                gt.speed,
                gt.recorded_at,
                v.vehicle_number,
                v.status
             FROM gps_tracking gt
             JOIN vehicles v
                ON gt.vehicle_id = v.id
             ORDER BY gt.vehicle_id, gt.recorded_at DESC`
        );

        res.json(result.rows);

    } catch (error) {
        console.error(
            "Latest GPS fetch error:",
            error
        );

        res.status(500).json({
            message: "Failed to fetch vehicle locations"
        });
    }
});
module.exports = router;