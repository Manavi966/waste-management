const express = require("express");
const pool = require("../config/db");
const { calculateHaversineDistance } = require("../services/trafficService");

const router = express.Router();

/**
 * Helper to parse a time string like "09:00 AM", "14:30", "10:30:00" into a Date object on a given dateStr
 */
function parseScheduledTimeToDate(timeStr, dateStr) {
    if (!timeStr) return null;
    try {
        const baseDate = new Date(dateStr);
        let hours = 0;
        let minutes = 0;

        const match = timeStr.toString().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
        if (match) {
            hours = parseInt(match[1], 10);
            minutes = parseInt(match[2], 10);
            const meridiem = match[3]?.toUpperCase();

            if (meridiem === "PM" && hours < 12) hours += 12;
            if (meridiem === "AM" && hours === 12) hours = 0;

            baseDate.setHours(hours, minutes, 0, 0);
            return baseDate;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ----------------------------------------------------
// GET /api/citizen/collection-status
// Location-based waste collection tracking for citizens
// ----------------------------------------------------
router.get("/collection-status", async (req, res) => {
    try {
        const { latitude, longitude, collection_point_id, date } = req.query;

        const dateStr = date || new Date().toISOString().split("T")[0];

        let targetPoint = null;
        let distanceFromCitizen = null;

        // Option A: Specific Collection Point Selected
        if (collection_point_id) {
            const pointRes = await pool.query(
                `SELECT id, name, address, ward, latitude, longitude, scheduled_time
                 FROM collection_points
                 WHERE id = $1`,
                [collection_point_id]
            );

            if (pointRes.rows.length === 0) {
                return res.status(404).json({
                    found: false,
                    message: "Selected collection point not found."
                });
            }

            targetPoint = pointRes.rows[0];

            if (latitude !== undefined && longitude !== undefined && !isNaN(Number(latitude)) && !isNaN(Number(longitude))) {
                distanceFromCitizen = calculateHaversineDistance(
                    Number(latitude),
                    Number(longitude),
                    Number(targetPoint.latitude),
                    Number(targetPoint.longitude)
                );
            }
        } 
        // Option B: Citizen Coordinates Provided -> Find Nearest Collection Point
        else if (latitude !== undefined && longitude !== undefined) {
            const citizenLat = Number(latitude);
            const citizenLon = Number(longitude);

            if (isNaN(citizenLat) || isNaN(citizenLon) || citizenLat < -90 || citizenLat > 90 || citizenLon < -180 || citizenLon > 180) {
                return res.status(400).json({
                    found: false,
                    message: "Invalid latitude or longitude coordinates provided."
                });
            }

            const allPointsRes = await pool.query(
                `SELECT id, name, address, ward, latitude, longitude, scheduled_time FROM collection_points`
            );

            if (allPointsRes.rows.length === 0) {
                return res.status(404).json({
                    found: false,
                    message: "No collection points found in the system."
                });
            }

            let minDistance = Infinity;
            let closestPoint = null;

            for (const pt of allPointsRes.rows) {
                const dist = calculateHaversineDistance(citizenLat, citizenLon, Number(pt.latitude), Number(pt.longitude));
                if (dist < minDistance) {
                    minDistance = dist;
                    closestPoint = pt;
                }
            }

            // Max search radius: 30 km
            if (minDistance > 30) {
                return res.json({
                    found: false,
                    message: "No collection point found near your location."
                });
            }

            targetPoint = closestPoint;
            distanceFromCitizen = minDistance;
        } else {
            return res.status(400).json({
                found: false,
                message: "Please provide your latitude/longitude or select a collection point."
            });
        }

        // STEP 2: Find assigned vehicle for targetPoint on dateStr
        const assignmentRes = await pool.query(
            `SELECT 
                rs.id AS route_stop_id,
                rs.sequence,
                rs.status AS collection_status,
                rs.expected_arrival,
                rs.actual_arrival,
                rs.actual_departure,
                rs.miss_reason,
                r.id AS route_id,
                r.route_date,
                r.status AS route_status,
                r.total_distance,
                r.estimated_time,
                v.id AS vehicle_id,
                v.vehicle_number,
                v.status AS vehicle_status,
                v.current_latitude,
                v.current_longitude,
                u.id AS driver_user_id,
                u.name AS driver_name,
                u.phone AS driver_phone
             FROM route_stops rs
             JOIN routes r ON rs.route_id = r.id
             JOIN vehicles v ON r.vehicle_id = v.id
             LEFT JOIN users u ON v.driver_id = u.id
             WHERE rs.collection_point_id = $1
               AND r.route_date = $2::date
             ORDER BY rs.id DESC
             LIMIT 1`,
            [targetPoint.id, dateStr]
        );

        const pointInfo = {
            id: targetPoint.id,
            name: targetPoint.name,
            address: targetPoint.address,
            ward: targetPoint.ward,
            latitude: Number(targetPoint.latitude),
            longitude: Number(targetPoint.longitude),
            scheduledTime: targetPoint.scheduled_time ? targetPoint.scheduled_time.toString() : "09:00 AM",
            distanceFromCitizen: distanceFromCitizen !== null ? Number(distanceFromCitizen.toFixed(2)) : null
        };

        // Edge case: No vehicle assignment for this point on this date
        if (assignmentRes.rows.length === 0) {
            return res.json({
                found: true,
                collectionPoint: pointInfo,
                collection_point: pointInfo,
                vehicle: null,
                driver: null,
                route: null,
                collection: null,
                tracking: null,
                gps: null,
                delay: null,
                message: "No vehicle has been assigned to this collection point yet."
            });
        }

        const assign = assignmentRes.rows[0];

        // Edge case: Vehicle under maintenance
        const isMaintenance = (assign.vehicle_status || "").toUpperCase() === "MAINTENANCE";

        // STEP 4: Live GPS Location for the assigned vehicle
        let gpsData = null;
        const gpsRes = await pool.query(
            `SELECT latitude, longitude, speed, recorded_at
             FROM gps_tracking
             WHERE vehicle_id = $1
             ORDER BY recorded_at DESC
             LIMIT 1`,
            [assign.vehicle_id]
        );

        if (gpsRes.rows.length > 0) {
            const g = gpsRes.rows[0];
            const distToPoint = calculateHaversineDistance(
                Number(g.latitude),
                Number(g.longitude),
                Number(targetPoint.latitude),
                Number(targetPoint.longitude)
            );

            const lastUpdatedDate = new Date(g.recorded_at);
            const now = new Date();
            const minutesAgo = Math.max(0, Math.round((now - lastUpdatedDate) / 60000));

            gpsData = {
                latitude: Number(g.latitude),
                longitude: Number(g.longitude),
                speed: Number(g.speed || 0),
                recordedAt: g.recorded_at,
                lastUpdated: g.recorded_at,
                minutesAgo,
                distanceFromCollectionPoint: Number(distToPoint.toFixed(2)),
                distance_to_collection_point_km: Number(distToPoint.toFixed(2))
            };
        } else if (assign.current_latitude && assign.current_longitude) {
            const distToPoint = calculateHaversineDistance(
                Number(assign.current_latitude),
                Number(assign.current_longitude),
                Number(targetPoint.latitude),
                Number(targetPoint.longitude)
            );
            gpsData = {
                latitude: Number(assign.current_latitude),
                longitude: Number(assign.current_longitude),
                speed: 0,
                recordedAt: null,
                lastUpdated: null,
                minutesAgo: null,
                distanceFromCollectionPoint: Number(distToPoint.toFixed(2)),
                distance_to_collection_point_km: Number(distToPoint.toFixed(2))
            };
        }

        // STEP 6: Delay Detection & Status Evaluation
        const now = new Date();
        let isDelayed = false;
        let delayMinutes = 0;
        let statusText = "🟢 On Time";
        let statusTone = "ON_SCHEDULE"; // ON_SCHEDULE, DELAYED, NOT_STARTED, COMPLETED, MISSED, MAINTENANCE

        // Format expected arrival string
        let formattedExpectedArrival = null;
        if (assign.expected_arrival) {
            formattedExpectedArrival = new Date(assign.expected_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (targetPoint.scheduled_time) {
            formattedExpectedArrival = targetPoint.scheduled_time.toString();
        }

        if (isMaintenance) {
            statusText = "🛠️ Vehicle currently unavailable (Under Maintenance)";
            statusTone = "MAINTENANCE";
        } else if (assign.collection_status === "COMPLETED") {
            statusText = "🟢 Collection Completed";
            statusTone = "COMPLETED";
        } else if (assign.collection_status === "MISSED") {
            statusText = `🔴 Collection Missed${assign.miss_reason ? ` (${assign.miss_reason})` : ""}`;
            statusTone = "MISSED";
        } else if (assign.route_status === "PLANNED") {
            statusText = "🔵 Route Not Started Yet";
            statusTone = "NOT_STARTED";
        } else {
            // Collection is PENDING and Route is IN_PROGRESS: Check expected arrival / scheduled time
            let targetArrival = null;
            if (assign.expected_arrival) {
                targetArrival = new Date(assign.expected_arrival);
            } else if (targetPoint.scheduled_time) {
                targetArrival = parseScheduledTimeToDate(targetPoint.scheduled_time, dateStr);
            }

            if (targetArrival && !isNaN(targetArrival.getTime())) {
                const diffMs = now.getTime() - targetArrival.getTime();
                if (diffMs > 5 * 60000) { // Delayed by more than 5 minutes
                    isDelayed = true;
                    delayMinutes = Math.round(diffMs / 60000);
                    statusText = `🟡 Vehicle Delayed (by ${delayMinutes} minutes)`;
                    statusTone = "DELAYED";
                } else {
                    isDelayed = false;
                    statusText = "🟢 On Time";
                    statusTone = "ON_SCHEDULE";
                }
            } else {
                statusText = "🟢 On Time";
                statusTone = "ON_SCHEDULE";
            }
        }

        const vehicleInfo = {
            id: assign.vehicle_id,
            vehicleNumber: assign.vehicle_number,
            vehicle_number: assign.vehicle_number,
            status: isMaintenance ? "MAINTENANCE" : (assign.vehicle_status || "IN_SERVICE")
        };

        const driverInfo = {
            id: assign.driver_user_id || null,
            name: assign.driver_name || "Unassigned",
            phone: assign.driver_phone && assign.driver_phone.trim() !== "" ? assign.driver_phone : null
        };

        const collectionInfo = {
            routeStopId: assign.route_stop_id,
            sequence: assign.sequence,
            status: assign.collection_status,
            expectedArrival: formattedExpectedArrival,
            actualArrival: assign.actual_arrival ? new Date(assign.actual_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
            actualDeparture: assign.actual_departure ? new Date(assign.actual_departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
            missReason: assign.miss_reason
        };

        const delayInfo = {
            isDelayed,
            minutes: delayMinutes,
            statusText,
            statusTone
        };

        res.json({
            found: true,
            collectionPoint: pointInfo,
            collection_point: pointInfo,
            vehicle: vehicleInfo,
            driver: driverInfo,
            route: {
                id: assign.route_id,
                routeDate: assign.route_date,
                status: assign.route_status,
                totalDistance: Number(assign.total_distance || 0),
                estimatedTime: assign.estimated_time || 0
            },
            collection: collectionInfo,
            tracking: gpsData,
            gps: gpsData,
            delay: delayInfo
        });

    } catch (error) {
        console.error("Citizen collection status error:", error);
        res.status(500).json({
            found: false,
            message: "Failed to fetch collection status."
        });
    }
});

module.exports = router;
