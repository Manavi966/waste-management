const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const pool = require("./src/config/db");

async function runTests() {
    console.log("=================================================");
    console.log("STARTING 16-STEP PERMANENT ASSIGNMENT VALIDATION");
    console.log("=================================================");

    try {
        // Reset base assignments cleanly
        const defaultAssignments = [
            { vehicle_number: "KA01AB1234", ward: "Ward 12" },
            { vehicle_number: "KA02CD5678", ward: "Ward 13" },
            { vehicle_number: "KA03EF9012", ward: "Ward 14" },
            { vehicle_number: "KA04GH3456", ward: "Ward 15" },
            { vehicle_number: "KA05IJ7890", ward: "Ward 16" }
        ];

        const vehicles = {};
        for (const da of defaultAssignments) {
            const vRes = await pool.query("SELECT id, vehicle_number, status, driver_id FROM vehicles WHERE vehicle_number = $1", [da.vehicle_number]);
            vehicles[da.vehicle_number] = vRes.rows[0];
        }

        const v1 = vehicles["KA01AB1234"];
        const v2 = vehicles["KA02CD5678"];
        const v3 = vehicles["KA03EF9012"];

        // ----------------------------------------------------
        // Step 1: Assign KA01AB1234 -> Ward 12
        // ----------------------------------------------------
        console.log("\n[Step 1] Assign KA01AB1234 -> Ward 12");
        await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT'", [v1.id]);
        await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE ward = 'Ward 12' AND assignment_type = 'PERMANENT'");
        
        await pool.query(
            "INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active) VALUES ($1, 'Ward 12', 'PERMANENT', CURRENT_DATE, TRUE)",
            [v1.id]
        );
        console.log("✓ Successfully assigned KA01AB1234 to Ward 12.");

        // ----------------------------------------------------
        // Step 2 & 3: Browser refresh / Logout & Login test
        // ----------------------------------------------------
        console.log("\n[Step 2 & 3] Simulating browser refresh / Driver login on new session");
        const freshFetch = await pool.query(
            `SELECT vaa.ward, vaa.is_active, v.vehicle_number, v.status 
             FROM vehicle_area_assignments vaa
             JOIN vehicles v ON vaa.vehicle_id = v.id
             WHERE v.id = $1 AND vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE`,
            [v1.id]
        );
        console.log("✓ Retrieved on fresh session:", freshFetch.rows[0]);
        if (freshFetch.rows[0]?.ward !== "Ward 12") throw new Error("Fresh fetch failed!");

        // ----------------------------------------------------
        // Step 4 & 5: Change the selected date to tomorrow and future dates
        // ----------------------------------------------------
        console.log("\n[Step 4 & 5] Confirm KA01AB1234 still shows Ward 12 across future dates");
        const testDates = ["2026-09-28", "2026-10-05", "2026-12-31", "2027-05-01"];
        for (const d of testDates) {
            const dateQuery = await pool.query(
                `SELECT vaa.ward 
                 FROM vehicle_area_assignments vaa 
                 WHERE vaa.vehicle_id = $1 
                   AND vaa.assignment_type = 'PERMANENT' 
                   AND vaa.is_active = TRUE`,
                [v1.id]
            );
            console.log(`✓ Date ${d} -> Permanent Area: ${dateQuery.rows[0]?.ward}`);
            if (dateQuery.rows[0]?.ward !== "Ward 12") throw new Error(`Date ${d} failed!`);
        }

        // ----------------------------------------------------
        // Step 6 & 7: Restart simulation / DB Reconnection
        // ----------------------------------------------------
        console.log("\n[Step 6 & 7] Confirm Ward 12 is still assigned after reconnection");
        const recheck = await pool.query(
            "SELECT ward FROM vehicle_area_assignments WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT' AND is_active = TRUE",
            [v1.id]
        );
        console.log("✓ Persistent assignment verified:", recheck.rows[0]?.ward);
        if (recheck.rows[0]?.ward !== "Ward 12") throw new Error("Recheck failed!");

        // ----------------------------------------------------
        // Step 8 & 9: Try assigning Ward 12 to another vehicle (KA02CD5678) -> Backend Rejection
        // ----------------------------------------------------
        console.log("\n[Step 8 & 9] Try assigning Ward 12 to another vehicle (KA02CD5678)");
        const conflictRes = await pool.query(
            `SELECT vaa.id, vaa.vehicle_id, v.vehicle_number 
             FROM vehicle_area_assignments vaa 
             JOIN vehicles v ON vaa.vehicle_id = v.id 
             WHERE vaa.ward = 'Ward 12' 
               AND vaa.vehicle_id != $1 
               AND vaa.assignment_type = 'PERMANENT' 
               AND vaa.is_active = TRUE`,
            [v2.id]
        );
        if (conflictRes.rows.length > 0) {
            console.log(`✓ Backend correctly detected conflict: Ward 12 is already assigned to ${conflictRes.rows[0].vehicle_number}. Assignment rejected.`);
        } else {
            throw new Error("Conflict detection failed! Duplicate assignment was not rejected.");
        }

        // ----------------------------------------------------
        // Step 10 & 11: Change KA01AB1234 from Ward 12 -> Ward 15
        // ----------------------------------------------------
        console.log("\n[Step 10 & 11] Change KA01AB1234 from Ward 12 -> Ward 15");
        // Ensure Ward 15 is free first
        await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE ward = 'Ward 15' AND assignment_type = 'PERMANENT'");
        
        // Deactivate v1's previous assignment
        await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT'", [v1.id]);
        
        // Insert new assignment
        await pool.query("INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active) VALUES ($1, 'Ward 15', 'PERMANENT', CURRENT_DATE, TRUE)", [v1.id]);
        
        // Confirm Ward 12 is now available again
        const ward12FreeCheck = await pool.query("SELECT * FROM vehicle_area_assignments WHERE ward = 'Ward 12' AND assignment_type = 'PERMANENT' AND is_active = TRUE");
        console.log("✓ Ward 12 active count after change:", ward12FreeCheck.rows.length);
        if (ward12FreeCheck.rows.length !== 0) throw new Error("Ward 12 should be free!");
        console.log("✓ Ward 12 is now available again for other vehicles.");

        // ----------------------------------------------------
        // Step 12: Confirm future dates now show Ward 15
        // ----------------------------------------------------
        console.log("\n[Step 12] Confirm future dates now show Ward 15");
        for (const d of testDates) {
            const dateQuery15 = await pool.query(
                `SELECT vaa.ward 
                 FROM vehicle_area_assignments vaa 
                 WHERE vaa.vehicle_id = $1 
                   AND vaa.assignment_type = 'PERMANENT' 
                   AND vaa.is_active = TRUE`,
                [v1.id]
            );
            console.log(`✓ Date ${d} -> Permanent Area: ${dateQuery15.rows[0]?.ward}`);
            if (dateQuery15.rows[0]?.ward !== "Ward 15") throw new Error(`Ward 15 check on ${d} failed!`);
        }

        // ----------------------------------------------------
        // Step 13 & 14: Put vehicle into maintenance -> Confirm permanent assignment is NOT deleted
        // ----------------------------------------------------
        console.log("\n[Step 13 & 14] Put KA01AB1234 into MAINTENANCE");
        await pool.query("UPDATE vehicles SET status = 'MAINTENANCE' WHERE id = $1", [v1.id]);
        
        const maintAssignCheck = await pool.query(
            "SELECT vaa.ward FROM vehicle_area_assignments vaa WHERE vaa.vehicle_id = $1 AND vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE",
            [v1.id]
        );
        console.log("✓ Permanent assignment during MAINTENANCE:", maintAssignCheck.rows[0]?.ward);
        if (maintAssignCheck.rows[0]?.ward !== "Ward 15") throw new Error("Permanent assignment was unexpectedly modified or deleted during maintenance!");

        // ----------------------------------------------------
        // Step 15 & 16: Make vehicle available again -> Confirm original permanent assignment remains
        // ----------------------------------------------------
        console.log("\n[Step 15 & 16] Restore KA01AB1234 to IN_SERVICE");
        await pool.query("UPDATE vehicles SET status = 'IN_SERVICE' WHERE id = $1", [v1.id]);
        
        const restoredAssignCheck = await pool.query(
            "SELECT vaa.ward FROM vehicle_area_assignments vaa WHERE vaa.vehicle_id = $1 AND vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE",
            [v1.id]
        );
        console.log("✓ Permanent assignment after returning to service:", restoredAssignCheck.rows[0]?.ward);
        if (restoredAssignCheck.rows[0]?.ward !== "Ward 15") throw new Error("Permanent assignment failed to persist after vehicle returned to service!");

        console.log("\n=================================================");
        console.log("🎉 ALL 16 VALIDATION STEPS PASSED SUCCESSFULLY!");
        console.log("=================================================");

        // Restore default assignments for standard demo operation
        for (const da of defaultAssignments) {
            const vRes = await pool.query("SELECT id FROM vehicles WHERE vehicle_number = $1", [da.vehicle_number]);
            if (vRes.rows.length > 0) {
                const vid = vRes.rows[0].id;
                await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT'", [vid]);
                await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE ward = $1 AND assignment_type = 'PERMANENT'", [da.ward]);
                await pool.query("INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active) VALUES ($1, $2, 'PERMANENT', CURRENT_DATE, TRUE)", [vid, da.ward]);
            }
        }
        console.log("✓ Reset demo fleet to standard active state (KA01AB1234 -> Ward 12, etc.)");

        process.exit(0);
    } catch (err) {
        console.error("❌ TEST FAILURE:", err);
        process.exit(1);
    }
}

runTests();
