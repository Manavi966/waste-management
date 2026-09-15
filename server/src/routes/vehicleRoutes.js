const express = require("express");
const pool = require("../config/db");

const router = express.Router();

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