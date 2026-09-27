require("dotenv").config();
const pool = require("./src/config/db");

async function inspectDb() {
    try {
        const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log("=== Tables in DB ===");
        console.log(tables.rows.map(r => r.table_name));

        const vehicles = await pool.query(`
            SELECT v.id, v.vehicle_number, v.status, v.driver_id, u.name AS driver_name, u.phone AS driver_phone
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            ORDER BY v.id
        `);
        console.log("\n=== Vehicles in DB ===");
        console.log(vehicles.rows);

        const wards = await pool.query("SELECT DISTINCT ward FROM collection_points ORDER BY ward");
        console.log("\n=== Distinct Wards in Collection Points ===");
        console.log(wards.rows);

        const points = await pool.query("SELECT id, name, address, ward, scheduled_time FROM collection_points ORDER BY ward, id");
        console.log("\n=== Collection Points in DB ===");
        console.log(points.rows);

        const assignments = await pool.query("SELECT * FROM vehicle_area_assignments");
        console.log("\n=== Vehicle Area Assignments ===");
        console.log(assignments.rows);
    } catch (e) {
        console.error("Error inspecting db:", e);
    } finally {
        process.exit(0);
    }
}

inspectDb();
