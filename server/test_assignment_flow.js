const http = require("http");

function request(options, data = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = "";
            res.on("data", chunk => body += chunk);
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(body) });
                } catch(e) {
                    resolve({ status: res.statusCode, raw: body });
                }
            });
        });
        req.on("error", reject);
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function runScenarioTests() {
    console.log("==================================================================");
    console.log("   AUTHORITY ASSIGNMENT & CONFLICT PREVENTION VERIFICATION TEST   ");
    console.log("==================================================================\n");

    const DATE = "2026-09-25";
    const NEXT_DATE = "2026-09-26";

    // 1. Fetch available vehicles
    const vehRes = await request({ hostname: "localhost", port: 5000, path: "/api/vehicles", method: "GET" });
    const vehicles = vehRes.body;
    const v1 = vehicles.find(v => v.vehicle_number === "KA01AB1234");
    const v2 = vehicles.find(v => v.vehicle_number === "KA02CD5678");
    const v3_maint = vehicles.find(v => v.status === "MAINTENANCE");
    const v5 = vehicles.find(v => v.vehicle_number === "KA05IJ7890");

    console.log(`Vehicles found:`);
    console.log(` - V1: ${v1?.vehicle_number} (id:${v1?.id}, driver_id:${v1?.driver_id})`);
    console.log(` - V2: ${v2?.vehicle_number} (id:${v2?.id}, driver_id:${v2?.driver_id})`);
    console.log(` - V3 (Maint): ${v3_maint?.vehicle_number} (id:${v3_maint?.id}, status:${v3_maint?.status})`);
    console.log(` - V5: ${v5?.vehicle_number} (id:${v5?.id}, driver_id:${v5?.driver_id})`);

    // STEP 0: Check initial availability on clean DATE
    console.log(`\n--- STEP 0: Initial Availability for ${DATE} ---`);
    const initialAvail = await request({
        hostname: "localhost",
        port: 5000,
        path: `/api/collection-points/available?date=${DATE}&vehicle_id=${v1.id}`,
        method: "GET"
    });
    console.log("Initial Counts:", initialAvail.body.counts);
    console.log("All points available:", initialAvail.body.counts.available === initialAvail.body.counts.total ? "PASS ✓" : "FAIL ✗");

    // TEST 1: Assigning Points 1, 2, 3, 4, 5 to Vehicle 1 (KA01AB1234)
    console.log(`\n--- TEST 1: Assigning Points 1, 2, 3, 4, 5 to Vehicle 1 (KA01AB1234) on ${DATE} ---`);
    const assign1 = await request({
        hostname: "localhost",
        port: 5000,
        path: "/api/routes/assign-locations",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, {
        vehicle_id: v1.id,
        collection_point_ids: [1, 2, 3, 4, 5],
        route_date: DATE
    });
    console.log("Assign V1 Response Status:", assign1.status, "(Expected: 200)");
    console.log("Assign V1 Message:", assign1.body.message);
    console.log("V1 Optimized Stops Count:", assign1.body.optimized_route?.length, "(Expected: 5)");
    console.log("V1 Total Distance:", assign1.body.total_distance_km, "km | Est Time:", assign1.body.estimated_time_mins, "mins");

    // TEST 2: Vehicle 2 checks available points on 2026-09-25
    console.log(`\n--- TEST 2: Checking Available Points for Vehicle 2 (KA02CD5678) on ${DATE} ---`);
    const availV2 = await request({
        hostname: "localhost",
        port: 5000,
        path: `/api/collection-points/available?date=${DATE}&vehicle_id=${v2.id}`,
        method: "GET"
    });
    console.log("Counts for V2:", availV2.body.counts);
    console.log("Available count:", availV2.body.counts.available, "| Assigned to other:", availV2.body.counts.assigned_to_other);

    // Verify points 1-5 are marked ASSIGNED_TO_OTHER locked to KA01AB1234
    const points1to5 = availV2.body.points.filter(p => [1, 2, 3, 4, 5].includes(p.id));
    const allAssignedToOther = points1to5.every(p => p.assignment_status === "ASSIGNED_TO_OTHER" && p.vehicle_number === "KA01AB1234");
    console.log("Points 1-5 locked to KA01AB1234 for V2:", allAssignedToOther ? "PASS ✓" : "FAIL ✗");

    // Assign points 6, 7, 8, 9, 10 to Vehicle 2
    console.log(`\n--- Assigning Points 6, 7, 8, 9, 10 to Vehicle 2 (KA02CD5678) on ${DATE} ---`);
    const assign2 = await request({
        hostname: "localhost",
        port: 5000,
        path: "/api/routes/assign-locations",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, {
        vehicle_id: v2.id,
        collection_point_ids: [6, 7, 8, 9, 10],
        route_date: DATE
    });
    console.log("Assign V2 Status:", assign2.status, "(Expected: 200) | Message:", assign2.body.message);

    // TEST 3: Vehicle 5 checks available points
    console.log(`\n--- TEST 3: Vehicle 5 (KA05IJ7890) sees remaining available points ---`);
    const availV5 = await request({
        hostname: "localhost",
        port: 5000,
        path: `/api/collection-points/available?date=${DATE}&vehicle_id=${v5.id}`,
        method: "GET"
    });
    console.log("Counts for V5:", availV5.body.counts);
    console.log("Available count for V5:", availV5.body.counts.available, "(Expected:", initialAvail.body.counts.total - 10, ")");

    // TEST 4: Duplicate Assignment Conflict Attempt (Vehicle 5 attempts to assign Point 1 which belongs to V1)
    console.log(`\n--- TEST 4: CONFLICT TEST - Vehicle 5 attempts to assign Point 1 (already assigned to V1) ---`);
    const conflictAttempt = await request({
        hostname: "localhost",
        port: 5000,
        path: "/api/routes/assign-locations",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, {
        vehicle_id: v5.id,
        collection_point_ids: [1, 11, 12],
        route_date: DATE
    });
    console.log("Conflict HTTP Status:", conflictAttempt.status, "(Expected: 409)");
    console.log("Conflict Response Message:", conflictAttempt.body.message);
    console.log("Conflict Prevention:", conflictAttempt.status === 409 ? "PASS ✓" : "FAIL ✗");

    // Assign points 11, 12, 13, 14, 15 to Vehicle 5
    console.log(`\n--- Assigning Points 11, 12, 13, 14, 15 to Vehicle 5 ---`);
    const assign5 = await request({
        hostname: "localhost",
        port: 5000,
        path: "/api/routes/assign-locations",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, {
        vehicle_id: v5.id,
        collection_point_ids: [11, 12, 13, 14, 15],
        route_date: DATE
    });
    console.log("Assign V5 Status:", assign5.status, "(Expected: 200) | Message:", assign5.body.message);

    // TEST 5: Maintenance vehicle assignment rejection
    console.log(`\n--- TEST 5: MAINTENANCE TEST - Attempting to assign points to maintenance vehicle ---`);
    const maintAttempt = await request({
        hostname: "localhost",
        port: 5000,
        path: "/api/routes/assign-locations",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    }, {
        vehicle_id: v3_maint.id,
        collection_point_ids: [16, 17],
        route_date: DATE
    });
    console.log("Maintenance HTTP Status:", maintAttempt.status, "(Expected: 400)");
    console.log("Maintenance Response Message:", maintAttempt.body.message);
    console.log("Maintenance Protection:", maintAttempt.status === 400 ? "PASS ✓" : "FAIL ✗");

    // TEST 6: Date-specific assignment isolation
    console.log(`\n--- TEST 6: DATE ISOLATION TEST - Querying availability on ${NEXT_DATE} ---`);
    const nextDateAvail = await request({
        hostname: "localhost",
        port: 5000,
        path: `/api/collection-points/available?date=${NEXT_DATE}&vehicle_id=${v2.id}`,
        method: "GET"
    });
    const pt1OnNextDate = nextDateAvail.body.points.find(p => p.id === 1);
    console.log(`Point 1 status on ${NEXT_DATE}:`, pt1OnNextDate?.assignment_status, "(Expected: AVAILABLE)");
    console.log("Date Isolation:", pt1OnNextDate?.assignment_status === "AVAILABLE" ? "PASS ✓" : "FAIL ✗");

    // TEST 7: Driver Dashboard Route Verification
    console.log(`\n--- TEST 7: DRIVER DASHBOARD TEST - Driver for Vehicle 1 sees only V1 stops ---`);
    const driverRes = await request({
        hostname: "localhost",
        port: 5000,
        path: `/api/routes/driver/my-route?driver_id=${v1.driver_id}&date=${DATE}`,
        method: "GET"
    });
    console.log("Driver Vehicle:", driverRes.body.vehicle?.vehicle_number);
    console.log("Driver Stops Count:", driverRes.body.stops?.length);
    console.log("Driver Stop Point IDs:", driverRes.body.stops?.map(s => s.collection_point.id));
    const allStopsBelongToV1 = driverRes.body.stops?.every(s => [1, 2, 3, 4, 5].includes(s.collection_point.id));
    console.log("Driver Route Isolation:", (driverRes.body.stops?.length === 5 && allStopsBelongToV1) ? "PASS ✓" : "FAIL ✗");

    // TEST 8: Citizen Dashboard Tracking Verification
    console.log(`\n--- TEST 8: CITIZEN DASHBOARD TEST - Citizen at Point 1 tracks Vehicle 1, Point 6 tracks Vehicle 2 ---`);
    const citizenRes1 = await request({
        hostname: "localhost",
        port: 5000,
        path: `/api/citizen/collection-status?collection_point_id=1&date=${DATE}`,
        method: "GET"
    });
    console.log("Citizen Point 1 -> Tracked Vehicle:", citizenRes1.body.vehicle?.vehicleNumber, "(Expected: KA01AB1234)");

    const citizenRes6 = await request({
        hostname: "localhost",
        port: 5000,
        path: `/api/citizen/collection-status?collection_point_id=6&date=${DATE}`,
        method: "GET"
    });
    console.log("Citizen Point 6 -> Tracked Vehicle:", citizenRes6.body.vehicle?.vehicleNumber, "(Expected: KA02CD5678)");

    const citizenMatches = citizenRes1.body.vehicle?.vehicleNumber === "KA01AB1234" && citizenRes6.body.vehicle?.vehicleNumber === "KA02CD5678";
    console.log("Citizen Tracking Routing:", citizenMatches ? "PASS ✓" : "FAIL ✗");

    console.log("\n==================================================================");
    console.log("             ALL ASSIGNMENT WORKFLOW TESTS COMPLETED              ");
    console.log("==================================================================");
}

runScenarioTests().catch(console.error);
