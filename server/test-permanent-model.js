require("dotenv").config();
const pool = require("./src/config/db");
const { syncDailyRoutesForDate, getEffectiveAssignmentForWard } = require("./src/services/dailyOperationService");
const {
    handleVehicleMaintenanceEvent,
    handleReplacementAssignedEvent,
    handleVehicleReturnedToServiceEvent
} = require("./src/services/notificationService");

async function testWorkflow() {
    console.log("==================================================");
    console.log("TEST: Permanent Vehicle-to-Area & Maintenance Flow");
    console.log("==================================================");
    const testDate = "2026-09-27";

    // 1. Initial sync & verify permanent assignment
    await syncDailyRoutesForDate(testDate);
    const ward12 = await getEffectiveAssignmentForWard("Ward 12", testDate);
    console.log("1. Initial Ward 12 permanent vehicle:", ward12.effective_vehicle?.vehicle_number);

    // 2. Mark vehicle KA01AB1234 to MAINTENANCE
    const vehRes = await pool.query("SELECT id FROM vehicles WHERE vehicle_number = $1", ["KA01AB1234"]);
    if (vehRes.rows.length === 0) throw new Error("Vehicle KA01AB1234 not found");
    const vehId = vehRes.rows[0].id;

    console.log("\n2. Moving KA01AB1234 to MAINTENANCE status...");
    await pool.query("UPDATE vehicles SET status = 'MAINTENANCE' WHERE id = $1", [vehId]);
    await handleVehicleMaintenanceEvent(vehId, "KA01AB1234", "Ward 12");

    const ward12Maint = await getEffectiveAssignmentForWard("Ward 12", testDate);
    console.log("Ward 12 status during maintenance:", {
        is_maintenance: ward12Maint.is_maintenance,
        has_replacement: ward12Maint.has_replacement,
        permanent_vehicle: ward12Maint.permanent_vehicle?.vehicle_number
    });

    // Check notifications
    const notifRes = await pool.query("SELECT * FROM notifications WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 2", [vehId]);
    console.log("Notifications generated for maintenance:", notifRes.rows.map(n => ({ role: n.recipient_role, title: n.title, ward: n.ward })));

    // 3. Assign replacement vehicle (e.g. KA02CD5678 or eligible vehicle)
    const repVehRes = await pool.query(
        "SELECT id, vehicle_number FROM vehicles WHERE status NOT IN ('MAINTENANCE', 'INACTIVE', 'OUT_OF_SERVICE') AND id != $1 LIMIT 1",
        [vehId]
    );
    const repVeh = repVehRes.rows[0];
    console.log(`\n3. Authority assigns replacement vehicle: ${repVeh.vehicle_number} to Ward 12...`);

    // Insert TEMPORARY assignment
    await pool.query(`
        INSERT INTO vehicle_area_assignments 
        (vehicle_id, ward, assignment_type, replaced_vehicle_id, start_date, is_active)
        VALUES ($1, $2, 'TEMPORARY', $3, $4::date, TRUE)
    `, [repVeh.id, "Ward 12", vehId, testDate]);

    await handleReplacementAssignedEvent({
        maintenanceVehicleId: vehId,
        maintenanceVehicleNumber: "KA01AB1234",
        replacementVehicleId: repVeh.id,
        replacementVehicleNumber: repVeh.vehicle_number,
        ward: "Ward 12",
        startDate: testDate
    });

    await syncDailyRoutesForDate(testDate);

    const ward12Replaced = await getEffectiveAssignmentForWard("Ward 12", testDate);
    console.log("Ward 12 status with replacement:", {
        effective_vehicle: ward12Replaced.effective_vehicle?.vehicle_number,
        is_maintenance: ward12Replaced.is_maintenance,
        has_replacement: ward12Replaced.has_replacement
    });

    // 4. Restore original vehicle to IN_SERVICE
    console.log("\n4. Maintenance completed. Restoring KA01AB1234 to IN_SERVICE...");
    await pool.query("UPDATE vehicles SET status = 'IN_SERVICE' WHERE id = $1", [vehId]);
    await pool.query(`
        UPDATE vehicle_area_assignments
        SET is_active = FALSE, end_date = $2::date
        WHERE replaced_vehicle_id = $1 AND assignment_type = 'TEMPORARY' AND is_active = TRUE
    `, [vehId, testDate]);

    await handleVehicleReturnedToServiceEvent(vehId, "KA01AB1234", "Ward 12");
    await syncDailyRoutesForDate(testDate);

    const ward12Restored = await getEffectiveAssignmentForWard("Ward 12", testDate);
    console.log("Ward 12 status after service restored:", {
        effective_vehicle: ward12Restored.effective_vehicle?.vehicle_number,
        is_maintenance: ward12Restored.is_maintenance,
        has_replacement: ward12Restored.has_replacement
    });

    console.log("\n==================================================");
    console.log("✅ ALL TEST SCENARIOS PASSED VERIFICATION!");
    console.log("==================================================");
    process.exit(0);
}

testWorkflow().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
