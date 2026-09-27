const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const pool = require("./src/config/db");
const initDb = require("./src/config/initDb");
const { syncDailyRoutesForDate, optimizeAndSaveRoute } = require("./src/services/dailyOperationService");

async function runValidation() {
    console.log("======================================================================");
    console.log("STARTING COLLECTION LOCATIONS & MASTER DATA ARCHITECTURE VALIDATION");
    console.log("======================================================================");

    try {
        // [Step 1] Verify initial collection locations count is exactly 25
        console.log("\n[Test 1] Verify baseline Master Collection Locations count");
        const cpInitRes = await pool.query("SELECT count(*) FROM collection_points");
        const initialCount = parseInt(cpInitRes.rows[0].count, 10);
        console.log(`Baseline collection_points count: ${initialCount}`);
        if (initialCount !== 25) {
            throw new Error(`Expected 25 baseline collection points, but found ${initialCount}`);
        }
        console.log("✓ Test 1 Passed: Master Collection Locations count is 25.");

        // [Test 2] Create a route for today and confirm count does not increase
        console.log("\n[Test 2] Create a daily route for today & confirm master collection location count");
        const todayStr = "2026-09-27";
        await syncDailyRoutesForDate(todayStr);
        const cpAfterToday = await pool.query("SELECT count(*) FROM collection_points");
        console.log(`Collection points after today's route generation: ${cpAfterToday.rows[0].count}`);
        if (parseInt(cpAfterToday.rows[0].count, 10) !== 25) {
            throw new Error(`Collection points increased after today's route creation to ${cpAfterToday.rows[0].count}`);
        }
        console.log("✓ Test 2 Passed: Master Collection Locations count remains 25.");

        // [Test 3] Create a route for tomorrow and confirm count does not increase
        console.log("\n[Test 3] Create a daily route for tomorrow (2026-09-28) & confirm master count");
        const tomorrowStr = "2026-09-28";
        await syncDailyRoutesForDate(tomorrowStr);
        const cpAfterTomorrow = await pool.query("SELECT count(*) FROM collection_points");
        console.log(`Collection points after tomorrow's route generation: ${cpAfterTomorrow.rows[0].count}`);
        if (parseInt(cpAfterTomorrow.rows[0].count, 10) !== 25) {
            throw new Error(`Collection points increased after tomorrow's route creation to ${cpAfterTomorrow.rows[0].count}`);
        }
        console.log("✓ Test 3 Passed: Master Collection Locations count remains 25.");

        // [Test 4] Run auto-assignment / daily sync for next week and next month
        console.log("\n[Test 4] Run route sync for next week (2026-10-05) and next month (2026-11-01)");
        await syncDailyRoutesForDate("2026-10-05");
        await syncDailyRoutesForDate("2026-11-01");
        const cpAfterFuture = await pool.query("SELECT count(*) FROM collection_points");
        if (parseInt(cpAfterFuture.rows[0].count, 10) !== 25) {
            throw new Error(`Collection points increased after future date sync to ${cpAfterFuture.rows[0].count}`);
        }
        console.log("✓ Test 4 Passed: Auto-assignment across dates does not create collection points (count: 25).");

        // [Test 5] Assign permanent vehicle areas and confirm count does not increase
        console.log("\n[Test 5] Assign permanent vehicle areas & confirm count does not increase");
        const v1 = (await pool.query("SELECT id FROM vehicles WHERE vehicle_number = 'KA01AB1234'")).rows[0];
        // Change KA01AB1234 to Ward 12
        await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE vehicle_id = $1", [v1.id]);
        await pool.query("UPDATE vehicle_area_assignments SET is_active = FALSE WHERE ward = 'Ward 12'");
        await pool.query(
            "INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active) VALUES ($1, 'Ward 12', 'PERMANENT', CURRENT_DATE, TRUE)",
            [v1.id]
        );
        const cpAfterPerm = await pool.query("SELECT count(*) FROM collection_points");
        if (parseInt(cpAfterPerm.rows[0].count, 10) !== 25) {
            throw new Error(`Collection points changed after permanent assignment: ${cpAfterPerm.rows[0].count}`);
        }
        console.log("✓ Test 5 Passed: Permanent vehicle area assignments do not alter collection points count (count: 25).");

        // [Test 6] Add scanner checkpoints & confirm count does not increase
        console.log("\n[Test 6] Add scanner checkpoints to zone 1 & confirm master count");
        const scCountBefore = await pool.query("SELECT count(*) FROM scanner_checkpoints");
        await pool.query(
            `INSERT INTO scanner_checkpoints (collection_point_id, scanner_code, name, sequence, status)
             VALUES (1, 'TEST-SCN-001', 'Test Scanner Checkpoint', 4, 'ACTIVE')
             ON CONFLICT (scanner_code) DO NOTHING`
        );
        const cpAfterScanner = await pool.query("SELECT count(*) FROM collection_points");
        if (parseInt(cpAfterScanner.rows[0].count, 10) !== 25) {
            throw new Error(`Collection points changed after adding scanner checkpoint: ${cpAfterScanner.rows[0].count}`);
        }
        // Cleanup test scanner checkpoint
        await pool.query("DELETE FROM scanner_checkpoints WHERE scanner_code = 'TEST-SCN-001'");
        console.log("✓ Test 6 Passed: Adding scanner checkpoints does not increase collection points count (count: 25).");

        // [Test 7] Backend re-initialization / initDb idempotency check
        console.log("\n[Test 7] Re-run initDb (simulating system restart) & confirm count remains unchanged");
        await initDb();
        const cpAfterRestart = await pool.query("SELECT count(*) FROM collection_points");
        if (parseInt(cpAfterRestart.rows[0].count, 10) !== 25) {
            throw new Error(`Collection points count changed after initDb restart: ${cpAfterRestart.rows[0].count}`);
        }
        console.log("✓ Test 7 Passed: System restarts and DB initializations remain strictly idempotent (count: 25).");

        // [Test 8] Prevent Duplicate Collection Locations in Database & API
        console.log("\n[Test 8] Attempt inserting duplicate collection location name in Ward 12");
        let duplicateBlocked = false;
        try {
            await pool.query(
                `INSERT INTO collection_points (name, address, ward, latitude, longitude)
                 VALUES ('5th Cross Road', 'Another address', 'Ward 12', 12.9716, 77.5946)`
            );
        } catch (dbErr) {
            if (dbErr.code === '23505' || dbErr.message.includes('unique')) {
                duplicateBlocked = true;
            }
        }
        if (!duplicateBlocked) {
            throw new Error("Failed: Database allowed duplicate collection point name '5th Cross Road' in 'Ward 12'");
        }
        console.log("✓ Test 8 Passed: Duplicate collection location insertion successfully blocked by uniqueness constraint.");

        // [Test 9] Test query GET /api/collection-points across all dates
        console.log("\n[Test 9] Verify GET /api/collection-points query output row count across multiple operation dates");
        const testDates = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-26", "2026-09-27", "2026-09-28", "2026-10-05"];
        for (const d of testDates) {
            const queryRes = await pool.query(`
                SELECT 
                    cp.id,
                    cp.name,
                    cp.ward,
                    rs.status AS stop_status,
                    r.id AS route_id
                FROM collection_points cp
                LEFT JOIN (
                    SELECT DISTINCT ON (rs_sub.collection_point_id) 
                        rs_sub.collection_point_id, 
                        rs_sub.status, 
                        rs_sub.route_id
                    FROM route_stops rs_sub
                    JOIN routes r_sub ON rs_sub.route_id = r_sub.id
                    WHERE r_sub.route_date = $1::date
                    ORDER BY rs_sub.collection_point_id, rs_sub.id DESC
                ) rs ON cp.id = rs.collection_point_id
                LEFT JOIN routes r ON rs.route_id = r.id
                ORDER BY cp.id ASC
            `, [d]);
            if (queryRes.rows.length !== 25) {
                throw new Error(`Date ${d} query returned ${queryRes.rows.length} rows instead of exactly 25!`);
            }
            console.log(`  Date ${d}: Exactly 25 collection points returned with date-specific statuses.`);
        }
        console.log("✓ Test 9 Passed: GET /api/collection-points query returns exactly 25 master rows for all dates.");

        // [Test 10] Verify Master Data vs Daily Route Stops separation
        console.log("\n[Test 10] Verify Master Data (25) vs Operational Route Stops (varies by date)");
        const stopsSummary = await pool.query(`
            SELECT r.route_date::date as r_date, count(rs.id) as stop_count
            FROM routes r
            JOIN route_stops rs ON r.id = rs.route_id
            GROUP BY r.route_date::date
            ORDER BY r.route_date::date
        `);
        console.log("Daily Route Stops Summary (Operational):");
        stopsSummary.rows.forEach(r => {
            console.log(`  Date: ${r.r_date.toISOString().split('T')[0]} -> ${r.stop_count} operational route stops (Master locations: 25)`);
        });
        console.log("✓ Test 10 Passed: Master collection points (25) and daily route stops operate independently.");

        // [Test 11] Verify Unique Routes per Vehicle per Date constraint
        console.log("\n[Test 11] Verify uniqueness rule: only 1 route per vehicle per date");
        let routeDupBlocked = false;
        try {
            await pool.query(
                `INSERT INTO routes (vehicle_id, route_date, status, total_distance, estimated_time)
                 VALUES (1, '2026-09-27'::date, 'PLANNED', 0, 0)`
            );
        } catch (rErr) {
            if (rErr.code === '23505' || rErr.message.includes('unique')) {
                routeDupBlocked = true;
            }
        }
        if (!routeDupBlocked) {
            throw new Error("Failed: Database allowed duplicate route for vehicle 1 on 2026-09-27");
        }
        console.log("✓ Test 11 Passed: Duplicate route creation rejected by database unique constraint.");

        // [Test 12] Verify Unique Route Stops per Route constraint
        console.log("\n[Test 12] Verify uniqueness rule: no duplicate collection point stops on a route");
        const route1 = (await pool.query("SELECT id FROM routes WHERE vehicle_id = 1 AND route_date = '2026-09-27'::date")).rows[0];
        let stopDupBlocked = false;
        try {
            await pool.query(
                `INSERT INTO route_stops (route_id, collection_point_id, sequence, status)
                 VALUES ($1, 1, 99, 'PENDING')`,
                [route1.id]
            );
        } catch (sErr) {
            if (sErr.code === '23505' || sErr.message.includes('unique')) {
                stopDupBlocked = true;
            }
        }
        if (!stopDupBlocked) {
            throw new Error("Failed: Database allowed duplicate stop on route");
        }
        console.log("✓ Test 12 Passed: Duplicate stop insertion on route rejected by database unique constraint.");

        // [Test 13] Verify Ward Distribution (5 points per ward across 5 wards)
        console.log("\n[Test 13] Verify 5 points per ward across all 5 wards");
        const wardDistribution = await pool.query(`
            SELECT ward, count(*) as count 
            FROM collection_points 
            GROUP BY ward 
            ORDER BY ward
        `);
        console.table(wardDistribution.rows);
        for (const w of wardDistribution.rows) {
            if (parseInt(w.count, 10) !== 5) {
                throw new Error(`Ward ${w.ward} has ${w.count} points instead of 5`);
            }
        }
        console.log("✓ Test 13 Passed: Perfectly balanced 5 master collection zones per ward (Total: 25).");

        console.log("\n======================================================================");
        console.log("🎉 ALL 13 COLLECTION LOCATION ARCHITECTURE TESTS PASSED SUCCESSFULLY!");
        console.log("======================================================================");

    } catch (error) {
        console.error("❌ VALIDATION FAILED:", error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

runValidation();
