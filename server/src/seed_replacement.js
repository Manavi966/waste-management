require("dotenv").config();
const pool = require("./config/db");

async function seedReplacements() {
    try {
        console.log("🛠️ Migration: Creating vehicle_replacements table and updating vehicle status enums...");

        await pool.query(`
            CREATE TABLE IF NOT EXISTS vehicle_replacements (
                id SERIAL PRIMARY KEY,
                route_id INTEGER REFERENCES routes(id),
                old_vehicle_id INTEGER REFERENCES vehicles(id),
                new_vehicle_id INTEGER REFERENCES vehicles(id),
                old_driver_id INTEGER REFERENCES users(id),
                new_driver_id INTEGER REFERENCES users(id),
                reason TEXT DEFAULT 'Vehicle Maintenance',
                replaced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Update test vehicles to distinct statuses
        await pool.query(`UPDATE vehicles SET status = 'IN_SERVICE' WHERE id = 1;`);
        await pool.query(`UPDATE vehicles SET status = 'MAINTENANCE' WHERE id = 2;`);
        await pool.query(`UPDATE vehicles SET status = 'AVAILABLE' WHERE id = 3;`);
        await pool.query(`UPDATE vehicles SET status = 'IN_SERVICE' WHERE id = 4;`);
        await pool.query(`UPDATE vehicles SET status = 'AVAILABLE' WHERE id = 5;`);

        console.log("✅ Migration & vehicle status setup complete.");
    } catch (err) {
        console.error("❌ Migration error:", err);
    } finally {
        await pool.end();
    }
}

seedReplacements();
