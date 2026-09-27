const express = require("express");
const pool = require("../config/db");

const router = express.Router();

/**
 * GET /api/collection-points
 * Get all master collection points with dynamic assignment status for a given operation date and vehicle.
 * Ensures master records are NEVER duplicated regardless of daily operational route stops.
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
                cp.minimum_collection_time_seconds,
                cp.total_scanners,
                cp.status AS zone_status,
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
                SELECT DISTINCT ON (rs_sub.collection_point_id) 
                    rs_sub.collection_point_id, 
                    rs_sub.status, 
                    rs_sub.route_id
                FROM route_stops rs_sub
                JOIN routes r_sub ON rs_sub.route_id = r_sub.id
                WHERE r_sub.route_date = $1::date
                ORDER BY rs_sub.collection_point_id, rs_sub.id DESC
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
 * Detailed available collection points list with master summary counts for Authority assignment
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
                cp.minimum_collection_time_seconds,
                cp.total_scanners,
                cp.status AS zone_status,
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
                SELECT DISTINCT ON (rs_sub.collection_point_id) 
                    rs_sub.collection_point_id, 
                    rs_sub.status, 
                    rs_sub.route_id
                FROM route_stops rs_sub
                JOIN routes r_sub ON rs_sub.route_id = r_sub.id
                WHERE r_sub.route_date = $1::date
                ORDER BY rs_sub.collection_point_id, rs_sub.id DESC
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

// Add new collection point (Master Data - with strict duplicate prevention)
router.post("/", async (req, res) => {
    try {
        const { name, address, ward, latitude, longitude, scheduled_time, minimum_collection_time_seconds, total_scanners } = req.body;

        if (!name || !address || !latitude || !longitude) {
            return res.status(400).json({ message: "Name, address, latitude, and longitude are required" });
        }

        const targetWard = ward || "Ward 12";

        // Business Duplicate Rule Check: One collection zone name per area
        const dupCheck = await pool.query(
            `SELECT id, name, ward FROM collection_points WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND LOWER(TRIM(ward)) = LOWER(TRIM($2))`,
            [name, targetWard]
        );

        if (dupCheck.rows.length > 0) {
            return res.status(409).json({
                conflict: true,
                message: `Collection location "${name}" already exists in ${targetWard}. Duplicate creation rejected.`
            });
        }

        const result = await pool.query(
            `INSERT INTO collection_points (name, address, ward, latitude, longitude, scheduled_time, minimum_collection_time_seconds, total_scanners, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
             RETURNING *`,
            [
                name.trim(), 
                address.trim(), 
                targetWard, 
                latitude, 
                longitude, 
                scheduled_time || "09:00:00",
                minimum_collection_time_seconds || 30,
                total_scanners || 3
            ]
        );

        res.status(201).json({
            message: "Collection point created successfully",
            collection_point: result.rows[0]
        });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({
                conflict: true,
                message: "A collection point with this name already exists in the specified ward."
            });
        }
        console.error("Create collection point error:", error);
        res.status(500).json({ message: "Failed to create collection point" });
    }
});

module.exports = router;
