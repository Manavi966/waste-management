require("dotenv").config();
const pool = require("./src/config/db");

async function updateVehicles() {
    try {
        console.log("Updating KA03EF9012 and KA04GH3456 to AVAILABLE...");
        await pool.query(`
            UPDATE vehicles
            SET status = 'AVAILABLE'
            WHERE vehicle_number IN ('KA03EF9012', 'KA04GH3456')
        `);

        const res = await pool.query(`
            SELECT id, vehicle_number, driver_id, status
            FROM vehicles
            ORDER BY id
        `);

        console.log("=== Vehicles Status in Database ===");
        console.table(res.rows);
    } catch (e) {
        console.error("Error updating vehicle status:", e);
    } finally {
        process.exit(0);
    }
}

updateVehicles();
