const express = require("express");
const pool = require("../config/db");

const router = express.Router();

// Submit a new complaint (Citizen)
router.post("/", async (req, res) => {
    try {
        const { citizen_id, collection_point_id, category, description, latitude, longitude, photo_url } = req.body;

        if (!category || !description) {
            return res.status(400).json({ message: "Category and description are required" });
        }

        const result = await pool.query(
            `INSERT INTO complaints 
             (citizen_id, collection_point_id, category, description, photo_url, latitude, longitude, priority, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'HIGH', 'PENDING', CURRENT_TIMESTAMP)
             RETURNING *`,
            [
                citizen_id || null,
                collection_point_id || null,
                category,
                description,
                photo_url || null,
                latitude || null,
                longitude || null
            ]
        );

        // Record activity log
        await pool.query(
            `INSERT INTO activity_logs (event_type, description) VALUES ($1, $2)`,
            ['COMPLAINT_CREATED', `New ${category} complaint submitted: ${description.slice(0, 50)}...`]
        );

        res.status(201).json({
            message: "Complaint registered successfully",
            complaint: result.rows[0]
        });
    } catch (error) {
        console.error("Create complaint error:", error);
        res.status(500).json({ message: "Failed to submit complaint" });
    }
});

// Get all complaints (Authority)
router.get("/", async (req, res) => {
    try {
        const { status, category } = req.query;
        let query = `
            SELECT 
                c.id,
                c.citizen_id,
                u.name AS citizen_name,
                c.collection_point_id,
                cp.name AS collection_point_name,
                cp.address AS location,
                c.category,
                c.description,
                c.latitude,
                c.longitude,
                c.priority,
                c.status,
                c.assigned_vehicle_id,
                v.vehicle_number AS assigned_vehicle_number,
                c.created_at,
                c.resolved_at
            FROM complaints c
            LEFT JOIN users u ON c.citizen_id = u.id
            LEFT JOIN collection_points cp ON c.collection_point_id = cp.id
            LEFT JOIN vehicles v ON c.assigned_vehicle_id = v.id
            WHERE 1=1
        `;
        const params = [];

        if (status && status !== 'ALL') {
            params.push(status);
            query += ` AND c.status = $${params.length}`;
        }

        if (category && category !== 'ALL') {
            params.push(category);
            query += ` AND c.category = $${params.length}`;
        }

        query += ` ORDER BY c.id DESC`;

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error("Fetch complaints error:", error);
        res.status(500).json({ message: "Failed to fetch complaints" });
    }
});

// Get complaints by citizen ID
router.get("/citizen/:citizenId", async (req, res) => {
    try {
        const { citizenId } = req.params;

        const result = await pool.query(
            `SELECT 
                c.id,
                c.category,
                c.description,
                c.status,
                c.created_at,
                cp.name AS location
             FROM complaints c
             LEFT JOIN collection_points cp ON c.collection_point_id = cp.id
             WHERE c.citizen_id = $1
             ORDER BY c.id DESC`,
            [citizenId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Fetch citizen complaints error:", error);
        res.status(500).json({ message: "Failed to fetch complaints" });
    }
});

// Update complaint status & assign vehicle (Authority)
router.put("/:id/assign", async (req, res) => {
    try {
        const { id } = req.params;
        const { vehicle_id, status } = req.body;

        const complaintRes = await pool.query(`SELECT * FROM complaints WHERE id = $1`, [id]);
        if (complaintRes.rows.length === 0) {
            return res.status(404).json({ message: "Complaint not found" });
        }

        const newStatus = status || (vehicle_id ? 'IN_PROGRESS' : 'PENDING');
        const resolvedAt = newStatus === 'RESOLVED' ? new Date() : null;

        const result = await pool.query(
            `UPDATE complaints
             SET assigned_vehicle_id = COALESCE($1, assigned_vehicle_id),
                 status = $2,
                 resolved_at = COALESCE($3, resolved_at)
             WHERE id = $4
             RETURNING *`,
            [vehicle_id || null, newStatus, resolvedAt, id]
        );

        // Record activity log
        await pool.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id) VALUES ($1, $2, $3)`,
            ['COMPLAINT_UPDATED', `Complaint #${id} updated to ${newStatus}`, vehicle_id || null]
        );

        res.json({
            message: `Complaint #${id} updated successfully`,
            complaint: result.rows[0]
        });
    } catch (error) {
        console.error("Assign complaint error:", error);
        res.status(500).json({ message: "Failed to update complaint" });
    }
});

module.exports = router;
