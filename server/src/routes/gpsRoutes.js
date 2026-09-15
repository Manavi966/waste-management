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