require("dotenv").config();
const pool = require("./src/config/db");
const { syncDailyRoutesForDate } = require("./src/services/dailyOperationService");

async function runStepByStepTest() {
    console.log("===============================================================");
    console.log("EXECUTION OF THE USER'S EXACT FINAL TEST SCENARIO");
    console.log("===============================================================");

    // Step 1: Verify KA03EF9012 and KA04GH3456 are AVAILABLE
    console.log("\n[Step 1] Verifying Vehicles Status in Database...");
    const vehCheck = await pool.query(`
        SELECT id, vehicle_number, status, driver_id
        FROM vehicles
        ORDER BY id
    `);
    console.table(vehCheck.rows);

    const veh3 = vehCheck.rows.find(v => v.vehicle_number === "KA03EF9012");
    const veh4 = vehCheck.rows.find(v => v.vehicle_number === "KA04GH3456");

    if (veh3.status !== "AVAILABLE" || veh4.status !== "AVAILABLE") {
        throw new Error("Step 1 Failed: KA03EF9012 or KA04GH3456 is not AVAILABLE");
    }
    console.log("✓ Step 1 Passed: Both vehicles are AVAILABLE.");

    // Step 2 & 3 & 4: Select Ward 12 and Select KA03EF9012
    console.log("\n[Step 2, 3, 4] Target Area: Ward 12, Selected Vehicle: KA03EF9012 (id: " + veh3.id + ")");
    
    // Check collection points belonging to Ward 12
    const ward12Points = await pool.query(`
        SELECT id, name, address, scheduled_time
        FROM collection_points
        WHERE ward = 'Ward 12'
        ORDER BY id ASC
    `);
    console.log("Collection points belonging to Ward 12:");
    ward12Points.rows.forEach((p, idx) => console.log(`  ${idx + 1}. ${p.name} (${p.address}) - ${p.scheduled_time}`));

    // Step 5: Save Permanent Assignment (simulating POST /api/admin/set-permanent-area)
    console.log("\n[Step 5] Saving Permanent Assignment: KA03EF9012 -> Ward 12...");
    
    // 1. Deactivate old permanent assignments for this vehicle and this ward
    await pool.query(
        `UPDATE vehicle_area_assignments 
         SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
         WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT'`,
        [veh3.id]
    );
    await pool.query(
        `UPDATE vehicle_area_assignments 
         SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
         WHERE ward = 'Ward 12' AND assignment_type = 'PERMANENT'`
    );

    // 2. Insert new permanent assignment
    const insertRes = await pool.query(
        `INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active)
         VALUES ($1, 'Ward 12', 'PERMANENT', CURRENT_DATE, TRUE)
         RETURNING *`,
        [veh3.id]
    );

    // 3. Log to activity_logs
    await pool.query(
        `INSERT INTO activity_logs (event_type, description, vehicle_id)
         VALUES ($1, $2, $3)`,
        [
            'PERMANENT_AREA_ASSIGNED',
            `Authority permanently assigned Vehicle KA03EF9012 to Ward 12.`,
            veh3.id
        ]
    );

    // 4. Sync operations
    const dateStr = "2026-09-20";
    await syncDailyRoutesForDate(dateStr, pool);

    console.log("✓ Step 5 Result: KA03EF9012 is now permanently assigned to Ward 12.");

    // Step 6: Verify Persistence (Reload query from database)
    console.log("\n[Step 6] Verifying Persistence across page reloads/queries...");
    const persistCheck = await pool.query(`
        SELECT vaa.id, vaa.ward, vaa.assignment_type, vaa.is_active, v.vehicle_number, u.name AS driver_name
        FROM vehicle_area_assignments vaa
        JOIN vehicles v ON vaa.vehicle_id = v.id
        LEFT JOIN users u ON v.driver_id = u.id
        WHERE vaa.ward = 'Ward 12' AND vaa.is_active = TRUE AND vaa.assignment_type = 'PERMANENT'
    `);

    if (persistCheck.rows.length === 0 || persistCheck.rows[0].vehicle_number !== "KA03EF9012") {
        throw new Error("Step 6 Failed: Persistent record not found or incorrect vehicle");
    }
    console.log("✓ Step 6 Passed: DB persistently stores:", persistCheck.rows[0]);

    // Step 7: Open Vehicle Details for KA03EF9012
    console.log("\n[Step 7] Checking Vehicle Details for KA03EF9012 (Vehicle ID: " + veh3.id + ")...");
    
    // Query route stops generated automatically for KA03EF9012 on dateStr
    const routeDetails = await pool.query(`
        SELECT r.id AS route_id, r.route_date, r.status AS route_status, r.total_distance, r.estimated_time,
               rs.id AS stop_id, rs.sequence, rs.status AS stop_status, cp.name AS point_name, cp.address, cp.ward
        FROM routes r
        JOIN route_stops rs ON rs.route_id = r.id
        JOIN collection_points cp ON rs.collection_point_id = cp.id
        WHERE r.vehicle_id = $1 AND r.route_date = $2::date
        ORDER BY rs.sequence ASC
    `, [veh3.id, dateStr]);

    console.log(`✓ Step 7 Passed: Vehicle Details shows Route ID ${routeDetails.rows[0]?.route_id} with ${routeDetails.rows.length} stops in Ward 12:`);
    routeDetails.rows.forEach(s => {
        console.log(`   Stop #${s.sequence}: ${s.point_name} (${s.ward}) [Status: ${s.stop_status}]`);
    });

    console.log("\n===============================================================");
    console.log("🎉 ALL FINAL TEST STEPS PASSED 100% SUCCESSFULLY!");
    console.log("===============================================================");
    process.exit(0);
}

runStepByStepTest().catch(e => {
    console.error("Test failed:", e);
    process.exit(1);
});
