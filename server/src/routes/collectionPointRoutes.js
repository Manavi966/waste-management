const express = require("express");
const pool = require("../config/db");

const router = express.Router();

/**
 * GET /api/collection-points
 * Get all collection points with dynamic assignment status for a given operation date and vehicle
 */
router.get("/", async (req, res) => {
    try {
        const { ward, date, vehicle_id } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];
        const currentVehId = vehicle_id ? Number(vehicle_id) : null;

        let query = `
            SELECT 
                cp.id,
                cp.name,
                cp.address,
                cp.ward,
                cp.latitude,
                cp.longitude,
                cp.scheduled_time,
                rs.status AS stop_status,
                r.id AS route_id,
                r.vehicle_id,
                v.vehicle_number,
                CASE 
                    WHEN r.vehicle_id IS NULL THEN 'AVAILABLE'
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN 'ASSIGNED_TO_CURRENT'
                    ELSE 'ASSIGNED_TO_OTHER'
                END AS assignment_status,
                CASE 
                    WHEN r.vehicle_id IS NULL THEN true
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN true
                    ELSE false
                END AS is_available,
                CASE 
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN true
                    ELSE false
                END AS is_assigned_to_current,
                CASE 
                    WHEN r.vehicle_id IS NOT NULL AND ($2::int IS NULL OR r.vehicle_id != $2::int) THEN true
                    ELSE false
                END AS is_assigned_to_other
            FROM collection_points cp
            LEFT JOIN (
                SELECT rs_sub.collection_point_id, rs_sub.status, rs_sub.route_id
                FROM route_stops rs_sub
                JOIN routes r_sub ON rs_sub.route_id = r_sub.id
                WHERE r_sub.route_date = $1::date
            ) rs ON cp.id = rs.collection_point_id
            LEFT JOIN routes r ON rs.route_id = r.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
        `;
        const params = [dateStr, currentVehId];

        if (ward) {
            query += ` WHERE cp.ward = $3`;
            params.push(ward);
        }

        query += ` ORDER BY cp.id ASC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error("Fetch collection points error:", error);
        res.status(500).json({ message: "Failed to fetch collection points" });
    }
});

/**
 * GET /api/collection-points/available
 * Detailed available collection points list with summary counts for Authority assignment
 */
router.get("/available", async (req, res) => {
    try {
        const { date, vehicle_id, ward } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];
        const currentVehId = vehicle_id ? Number(vehicle_id) : null;

        let query = `
            SELECT 
                cp.id,
                cp.name,
                cp.address,
                cp.ward,
                cp.latitude,
                cp.longitude,
                cp.scheduled_time,
                rs.status AS stop_status,
                r.id AS route_id,
                r.vehicle_id,
                v.vehicle_number,
                CASE 
                    WHEN r.vehicle_id IS NULL THEN 'AVAILABLE'
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN 'ASSIGNED_TO_CURRENT'
                    ELSE 'ASSIGNED_TO_OTHER'
                END AS assignment_status,
                CASE 
                    WHEN r.vehicle_id IS NULL THEN true
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN true
                    ELSE false
                END AS is_available,
                CASE 
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN true
                    ELSE false
                END AS is_assigned_to_current,
                CASE 
                    WHEN r.vehicle_id IS NOT NULL AND ($2::int IS NULL OR r.vehicle_id != $2::int) THEN true
                    ELSE false
                END AS is_assigned_to_other
            FROM collection_points cp
            LEFT JOIN (
                SELECT rs_sub.collection_point_id, rs_sub.status, rs_sub.route_id
                FROM route_stops rs_sub
                JOIN routes r_sub ON rs_sub.route_id = r_sub.id
                WHERE r_sub.route_date = $1::date
            ) rs ON cp.id = rs.collection_point_id
            LEFT JOIN routes r ON rs.route_id = r.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
        `;
        const params = [dateStr, currentVehId];

        if (ward) {
            query += ` WHERE cp.ward = $3`;
            params.push(ward);
        }

        query += ` ORDER BY cp.id ASC`;

        const result = await pool.query(query, params);
        const rows = result.rows;

        const total = rows.length;
        const available = rows.filter(r => r.assignment_status === 'AVAILABLE').length;
        const assignedCurrent = rows.filter(r => r.assignment_status === 'ASSIGNED_TO_CURRENT').length;
        const assignedOther = rows.filter(r => r.assignment_status === 'ASSIGNED_TO_OTHER').length;
        const totalAssigned = assignedCurrent + assignedOther;

        res.json({
            date: dateStr,
            vehicle_id: currentVehId,
            counts: {
                total,
                available,
                assigned_to_current: assignedCurrent,
                assigned_to_other: assignedOther,
                total_assigned: totalAssigned
            },
            points: rows
        });
    } catch (error) {
        console.error("Fetch available collection points error:", error);
        res.status(500).json({ message: "Failed to fetch available collection points" });
    }
});

// Add new collection point
router.post("/", async (req, res) => {
    try {
        const { name, address, ward, latitude, longitude, scheduled_time } = req.body;

        if (!name || !address || !latitude || !longitude) {
            return res.status(400).json({ message: "Name, address, latitude, and longitude are required" });
        }

        const result = await pool.query(
            `INSERT INTO collection_points (name, address, ward, latitude, longitude, scheduled_time)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [name, address, ward || "General", latitude, longitude, scheduled_time || "09:00:00"]
        );

        res.status(201).json({
            message: "Collection point created successfully",
            collection_point: result.rows[0]
        });
    } catch (error) {
        console.error("Create collection point error:", error);
        res.status(500).json({ message: "Failed to create collection point" });
    }
});

module.exports = router;
