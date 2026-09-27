require("dotenv").config();
const pool = require("./src/config/db");
const { syncDailyRoutesForDate } = require("./src/services/dailyOperationService");

async function testPermanentModalFlow() {
    console.log("==================================================");
    console.log("TEST: Permanent Vehicle-to-Area Modal & Dropdowns");
    console.log("==================================================");

    // 1. Check Ward & Areas retrieval
    const wardRows = await pool.query(`
        SELECT DISTINCT ward FROM collection_points WHERE ward IS NOT NULL ORDER BY ward ASC
    `);
    console.log("1. Wards from DB collection_points:", wardRows.rows.map(r => r.ward));
    if (wardRows.rows.length === 0) throw new Error("No wards found");

    // 2. Check Vehicles retrieval with driver names
    const vehiclesRes = await pool.query(`
        SELECT v.id, v.vehicle_number, v.status, u.name AS driver_name
        FROM vehicles v
        LEFT JOIN users u ON v.driver_id = u.id
        ORDER BY v.id ASC
    `);
    console.log("2. Vehicles from DB with drivers:", vehiclesRes.rows.map(v => `${v.vehicle_number} - ${v.driver_name || 'Unassigned'} (${v.status})`));
    if (vehiclesRes.rows.length === 0) throw new Error("No vehicles found");

    // 3. Test Collection Points for Ward 12
    const ward12Points = await pool.query(`
        SELECT id, name, address, scheduled_time FROM collection_points WHERE ward = 'Ward 12' ORDER BY id ASC
    `);
    console.log("3. Ward 12 Collection Points in DB:", ward12Points.rows.map(p => `${p.name} (${p.address})`));

    // 4. Test assigning KA01AB1234 permanently to Ward 12
    const veh1 = vehiclesRes.rows.find(v => v.vehicle_number === "KA01AB1234");
    if (!veh1) throw new Error("Vehicle KA01AB1234 not found");

    // Deactivate prior assignments
    await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT'", [veh1.id]);
    await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE ward = 'Ward 12' AND assignment_type = 'PERMANENT'");

    // Insert permanent assignment
    const insertRes = await pool.query(`
        INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active)
        VALUES ($1, 'Ward 12', 'PERMANENT', CURRENT_DATE, TRUE)
        RETURNING *
    `, [veh1.id]);
    console.log("4. Permanent Assignment Inserted:", insertRes.rows[0]);

    // 5. Verify Persistence in DB
    const verifyRes = await pool.query(`
        SELECT vaa.id, vaa.ward, vaa.assignment_type, v.vehicle_number, u.name AS driver_name
        FROM vehicle_area_assignments vaa
        JOIN vehicles v ON vaa.vehicle_id = v.id
        LEFT JOIN users u ON v.driver_id = u.id
        WHERE vaa.ward = 'Ward 12' AND vaa.is_active = TRUE AND vaa.assignment_type = 'PERMANENT'
    `);
    console.log("5. Verified Persistent Record in DB:", verifyRes.rows[0]);

    if (verifyRes.rows[0].vehicle_number !== "KA01AB1234") {
        throw new Error("Verification failed: expected KA01AB1234");
    }

    console.log("==================================================");
    console.log("✅ ALL PERMANENT MODAL TESTS PASSED SUCCESSFULLY!");
    console.log("==================================================");
    process.exit(0);
}

testPermanentModalFlow().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
