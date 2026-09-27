require("dotenv").config();
const pool = require("./src/config/db");

async function inspectColumns() {
    try {
        const tables = ['activity_logs', 'vehicle_area_assignments', 'vehicles', 'collection_points', 'routes', 'route_stops', 'notifications'];
        for (const t of tables) {
            const res = await pool.query(
                `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
                [t]
            );
            console.log(`\n=== Table: ${t} ===`);
            console.log(res.rows);
        }
    } catch (e) {
        console.error("Error inspecting columns:", e);
    } finally {
        process.exit(0);
    }
}

inspectColumns();
