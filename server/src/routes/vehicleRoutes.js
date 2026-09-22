const express = require("express");
const pool = require("../config/db");

const router = express.Router();

// Get all vehicles with driver details and status
router.get("/", async (req, res) => {
    try {
        const { date } = req.query;
        const result = await pool.query(
            `SELECT 
                v.id,
                v.vehicle_number,
                v.driver_id,
                u.name AS driver_name,
                v.status,
                v.current_latitude,
                v.current_longitude,
                COALESCE(
                    (SELECT COUNT(rs.id) 
                     FROM route_stops rs 
                     JOIN routes r ON rs.route_id = r.id 
                     WHERE r.vehicle_id = v.id AND r.route_date = COALESCE($1::date, CURRENT_DATE)),
                    0
                ) AS assigned_stops,
                COALESCE(
                    (SELECT COUNT(rs.id) 
                     FROM route_stops rs 
                     JOIN routes r ON rs.route_id = r.id 
                     WHERE r.vehicle_id = v.id AND r.route_date = COALESCE($1::date, CURRENT_DATE) AND rs.status = 'COMPLETED'),
                    0
                ) AS completed_stops
             FROM vehicles v
             LEFT JOIN users u ON v.driver_id = u.id
             ORDER BY v.id ASC`,
            [date || null]
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Vehicles fetch error:", error);
        res.status(500).json({ message: "Failed to fetch vehicles" });
    }
});

// Get detailed vehicle info including completed, pending, and missed areas
router.get("/:id/details", async (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.query;

        const vehicleRes = await pool.query(
            `SELECT 
                v.id AS vehicle_id,
                v.vehicle_number,
                v.status AS vehicle_status,
                v.current_latitude,
                v.current_longitude,
                u.name AS driver_name,
                u.phone AS driver_phone,
                r.id AS route_id,
                r.route_date,
                r.status AS route_status,
                r.total_distance,
                r.estimated_time
             FROM vehicles v
             LEFT JOIN users u ON v.driver_id = u.id
             LEFT JOIN routes r ON r.vehicle_id = v.id AND r.route_date = COALESCE($2::date, CURRENT_DATE)
             WHERE v.id = $1`,
            [id, date || null]
        );

        if (vehicleRes.rows.length === 0) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const vehicleInfo = vehicleRes.rows[0];
        let stops = [];

        if (vehicleInfo.route_id) {
            const stopsRes = await pool.query(
                `SELECT 
                    rs.id AS stop_id,
                    rs.id AS route_stop_id,
                    rs.sequence,
                    rs.status AS stop_status,
                    rs.status,
                    rs.expected_arrival,
                    rs.actual_arrival,
                    rs.actual_departure,
                    rs.miss_reason,
                    cp.id AS collection_point_id,
                    cp.name AS point_name,
                    cp.name,
                    cp.address,
                    cp.ward,
                    cp.latitude,
                    cp.longitude,
                    cp.scheduled_time
                 FROM route_stops rs
                 JOIN collection_points cp ON rs.collection_point_id = cp.id
                 WHERE rs.route_id = $1
                 ORDER BY rs.sequence ASC`,
                [vehicleInfo.route_id]
            );
            stops = stopsRes.rows;
        }

        const completedStops = stops.filter(s => s.stop_status === 'COMPLETED' || s.status === 'COMPLETED');
        const pendingStops = stops.filter(s => s.stop_status === 'PENDING' || s.status === 'PENDING');
        const missedStops = stops.filter(s => s.stop_status === 'MISSED' || s.status === 'MISSED');

        res.json({
            vehicle: vehicleInfo,
            summary: {
                total_stops: stops.length,
                completed_count: completedStops.length,
                pending_count: pendingStops.length,
                missed_count: missedStops.length
            },
            completed_areas: completedStops,
            pending_areas: pendingStops,
            missed_areas: missedStops,
            all_stops: stops
        });
    } catch (error) {
        console.error("Fetch vehicle details error:", error);
        res.status(500).json({ message: "Failed to fetch vehicle details" });
    }
});

// Add a new vehicle (Authority)
router.post("/", async (req, res) => {
    try {
        const { vehicle_number, driver_id, status } = req.body;

        if (!vehicle_number) {
            return res.status(400).json({ message: "Vehicle number is required" });
        }

        const result = await pool.query(
            `INSERT INTO vehicles (vehicle_number, driver_id, status, current_latitude, current_longitude)
             VALUES ($1, $2, $3, 12.9716, 77.5946)
             RETURNING *`,
            [vehicle_number, driver_id || null, status || 'AVAILABLE']
        );

        res.status(201).json({
            message: "Vehicle created successfully",
            vehicle: result.rows[0]
        });
    } catch (error) {
        console.error("Add vehicle error:", error);
        res.status(500).json({ message: "Failed to create vehicle" });
    }
});

// Update vehicle driver / status
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { driver_id, status } = req.body;

        const result = await pool.query(
            `UPDATE vehicles
             SET driver_id = COALESCE($1, driver_id),
                 status = COALESCE($2, status)
             WHERE id = $3
             RETURNING *`,
            [driver_id !== undefined ? driver_id : null, status || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const vehicle = result.rows[0];
        let requiresReassignment = false;
        let pendingStopsCount = 0;

        // If status changed to MAINTENANCE, check for pending stops on active/planned routes
        if (status && status.toUpperCase() === 'MAINTENANCE') {
            const pendingStopsRes = await pool.query(
                `SELECT COUNT(rs.id) AS count
                 FROM route_stops rs
                 JOIN routes r ON rs.route_id = r.id
                 WHERE r.vehicle_id = $1
                   AND (r.status = 'PLANNED' OR r.status = 'IN_PROGRESS')
                   AND rs.status = 'PENDING'`,
                [id]
            );
            pendingStopsCount = Number(pendingStopsRes.rows[0]?.count || 0);
            requiresReassignment = pendingStopsCount > 0;

            await pool.query(
                `INSERT INTO activity_logs (event_type, description, vehicle_id)
                 VALUES ($1, $2, $3)`,
                [
                    'VEHICLE_MAINTENANCE',
                    `Vehicle ${vehicle.vehicle_number} marked as MAINTENANCE.${requiresReassignment ? ` ${pendingStopsCount} assigned collection points require reassignment.` : ''}`,
                    id
                ]
            );
        } else if (status) {
            await pool.query(
                `INSERT INTO activity_logs (event_type, description, vehicle_id)
                 VALUES ($1, $2, $3)`,
                ['VEHICLE_STATUS_UPDATED', `Vehicle ${vehicle.vehicle_number} status updated to ${status}`, id]
            );
        }

        res.json({
            message: requiresReassignment
                ? `Vehicle ${vehicle.vehicle_number} status updated to MAINTENANCE. ${pendingStopsCount} assigned collection points require reassignment.`
                : "Vehicle updated successfully",
            vehicle,
            requires_reassignment: requiresReassignment,
            pending_stops_count: pendingStopsCount
        });
    } catch (error) {
        console.error("Update vehicle error:", error);
        res.status(500).json({ message: "Failed to update vehicle" });
    }
});

// Get vehicle assigned to a driver (Preserved endpoint)
router.get("/driver/:driverId", async (req, res) => {
    try {
        const { driverId } = req.params;

        const result = await pool.query(
            `SELECT id, vehicle_number, status,
                    current_latitude, current_longitude
             FROM vehicles
             WHERE driver_id = $1`,
            [driverId]
        );

        res.json(result.rows);

    } catch (error) {
        console.error("Vehicle fetch error:", error);

        res.status(500).json({
            message: "Failed to fetch vehicle"
        });
    }
});

module.exports = router;