const express = require("express");
const router = express.Router();

const pool = require("../config/db");

// Authority dashboard
router.get("/dashboard", async (req, res) => {
    try {

        // -----------------------------
        // VEHICLE SUMMARY
        // -----------------------------

        const vehicleResult = await pool.query(`
            SELECT
                COUNT(*) AS total_vehicles,
                COUNT(*) FILTER (
                    WHERE status = 'ACTIVE'
                ) AS active_vehicles,
                COUNT(*) FILTER (
                    WHERE status = 'AVAILABLE'
                ) AS available_vehicles,
                COUNT(*) FILTER (
                    WHERE status = 'INACTIVE'
                ) AS inactive_vehicles
            FROM vehicles
        `);


        // -----------------------------
        // COLLECTION SUMMARY
        // -----------------------------

        const collectionResult = await pool.query(`
            SELECT
                COUNT(*) AS total_stops,

                COUNT(*) FILTER (
                    WHERE status = 'COMPLETED'
                ) AS completed_stops,

                COUNT(*) FILTER (
                    WHERE status = 'PENDING'
                ) AS pending_stops,

                COUNT(*) FILTER (
                    WHERE status = 'MISSED'
                ) AS missed_stops

            FROM route_stops
        `);


        // -----------------------------
        // MISSED LOCATIONS
        // -----------------------------

        const missedResult = await pool.query(`
            SELECT
                rs.id,
                rs.sequence,
                rs.status,
                rs.miss_reason,

                cp.name AS collection_point,
                cp.address,

                r.id AS route_id,
                r.route_date,

                v.id AS vehicle_id,
                v.vehicle_number

            FROM route_stops rs

            JOIN collection_points cp
                ON rs.collection_point_id = cp.id

            JOIN routes r
                ON rs.route_id = r.id

            JOIN vehicles v
                ON r.vehicle_id = v.id

            WHERE rs.status = 'MISSED'

            ORDER BY rs.id DESC
        `);


        // -----------------------------
        // RESPONSE
        // -----------------------------

        res.json({
            vehicles: vehicleResult.rows[0],
            collections: collectionResult.rows[0],
            missed_locations: missedResult.rows
        });

    } catch (error) {

        console.error(
            "Admin dashboard error:",
            error
        );

        res.status(500).json({
            message: "Failed to load authority dashboard."
        });
    }
});


module.exports = router;