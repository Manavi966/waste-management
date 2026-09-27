const express = require("express");
const pool = require("../config/db");
const { optimizeRoute } = require("../services/routeOptimizer");

const router = express.Router();
const { syncDailyRoutesForDate } = require("../services/dailyOperationService");

/**
 * Helper function to optimize and persist the visiting sequence for a given route
 * @param {number} routeId Route database ID
 * @param {object} dbPool Database pool instance
 */
async function optimizeAndSaveRoute(routeId, dbPool = pool) {
    // 1. Get route & vehicle details
    const routeResult = await dbPool.query(
        `SELECT r.*, v.vehicle_number, v.current_latitude, v.current_longitude, v.status AS vehicle_status
         FROM routes r
         JOIN vehicles v ON r.vehicle_id = v.id
         WHERE r.id = $1`,
        [routeId]
    );

    if (routeResult.rows.length === 0) {
        throw new Error("Route not found");
    }

    const route = routeResult.rows[0];

    // 2. Get all stops for this route
    const stopsResult = await dbPool.query(
        `SELECT
            rs.id AS route_stop_id,
            rs.sequence,
            rs.status AS stop_status,
            cp.id AS collection_point_id,
            cp.name,
            cp.address,
            cp.ward,
            cp.latitude,
            cp.longitude,
            cp.scheduled_time
         FROM route_stops rs
         JOIN collection_points cp
            ON rs.collection_point_id = cp.id
         WHERE rs.route_id = $1
         ORDER BY rs.sequence, rs.id`,
        [routeId]
    );

    if (stopsResult.rows.length === 0) {
        await dbPool.query(
            `UPDATE routes SET total_distance = 0.00, estimated_time = 0 WHERE id = $1`,
            [routeId]
        );
        return {
            route,
            orderedPoints: [],
            totalDistance: 0,
            estimatedTotalMinutes: 0
        };
    }

    // 3. Determine starting point: vehicle's current GPS -> latest gps_tracking -> first collection point
    let startPoint;
    if (
        route.current_latitude !== null &&
        route.current_longitude !== null
    ) {
        startPoint = {
            latitude: Number(route.current_latitude),
            longitude: Number(route.current_longitude)
        };
    } else {
        const gpsRes = await dbPool.query(
            `SELECT latitude, longitude FROM gps_tracking WHERE vehicle_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
            [route.vehicle_id]
        );
        if (gpsRes.rows.length > 0) {
            startPoint = {
                latitude: Number(gpsRes.rows[0].latitude),
                longitude: Number(gpsRes.rows[0].longitude)
            };
        } else {
            startPoint = {
                latitude: Number(stopsResult.rows[0].latitude),
                longitude: Number(stopsResult.rows[0].longitude)
            };
        }
    }

    const points = stopsResult.rows.map((stop) => ({
        routeStopId: stop.route_stop_id,
        collectionPointId: stop.collection_point_id,
        name: stop.name,
        address: stop.address,
        ward: stop.ward,
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        scheduled_time: stop.scheduled_time,
        stop_status: stop.stop_status
    }));

    const result = optimizeRoute(points, startPoint);

    // 4. Update sequence in route_stops
    for (let i = 0; i < result.orderedPoints.length; i++) {
        await dbPool.query(
            `UPDATE route_stops
             SET sequence = $1
             WHERE id = $2`,
            [i + 1, result.orderedPoints[i].routeStopId]
        );
    }

    // 5. Update route total distance and estimated time
    const estTime = result.estimatedTotalMinutes || Math.max(Math.round(result.totalDistance * 2.4), 5);
    await dbPool.query(
        `UPDATE routes
         SET total_distance = $1, estimated_time = $2
         WHERE id = $3`,
        [
            result.totalDistance.toFixed(2),
            estTime,
            routeId
        ]
    );

    return {
        route,
        orderedPoints: result.orderedPoints,
        totalDistance: Number(result.totalDistance.toFixed(2)),
        estimatedTotalMinutes: estTime
    };
}

// ----------------------------------------------------
// GET /api/routes/driver/my-route
// Get logged-in driver's assigned vehicle, optimized route, stops in sequence, next stop, and latest GPS
// ----------------------------------------------------
router.get("/driver/my-route", async (req, res) => {
    try {
        const { driver_id, date } = req.query;
        if (!driver_id) {
            return res.status(400).json({ message: "driver_id query parameter is required" });
        }

        const dateStr = date || new Date().toISOString().split("T")[0];

        // Ensure routes are synced for the driver's vehicle on this date
        await syncDailyRoutesForDate(dateStr);

        // 1. Find vehicle assigned to driver with permanent and temporary ward assignments
        const vehRes = await pool.query(
            `SELECT v.id, v.vehicle_number, v.status, v.current_latitude, v.current_longitude,
                    u.name AS driver_name, u.phone AS driver_phone,
                    (
                        SELECT vaa.ward 
                        FROM vehicle_area_assignments vaa 
                        WHERE vaa.vehicle_id = v.id 
                          AND vaa.assignment_type = 'PERMANENT' 
                          AND vaa.is_active = TRUE 
                        LIMIT 1
                    ) AS permanent_ward,
                    (
                        SELECT vaa.ward 
                        FROM vehicle_area_assignments vaa 
                        WHERE vaa.vehicle_id = v.id 
                          AND vaa.assignment_type = 'TEMPORARY' 
                          AND vaa.is_active = TRUE 
                          AND vaa.start_date <= $2::date 
                          AND (vaa.end_date IS NULL OR vaa.end_date >= $2::date)
                        ORDER BY vaa.id DESC 
                        LIMIT 1
                    ) AS temporary_ward
             FROM vehicles v
             JOIN users u ON v.driver_id = u.id
             WHERE v.driver_id = $1`,
            [driver_id, dateStr]
        );

        if (vehRes.rows.length === 0) {
            return res.json({
                vehicle: null,
                route: null,
                stops: [],
                next_stop: null,
                summary: { total_stops: 0, completed_count: 0, pending_count: 0, missed_count: 0, progress_percent: 0 },
                gps: null,
                message: "No vehicle currently assigned to this driver."
            });
        }

        const vehicle = vehRes.rows[0];

        // 2. Find route for vehicle on dateStr
        const routeRes = await pool.query(
            `SELECT id, vehicle_id, route_date, status, total_distance, estimated_time
             FROM routes
             WHERE vehicle_id = $1 AND route_date = $2::date`,
            [vehicle.id, dateStr]
        );

        let route = null;
        let stops = [];

        if (routeRes.rows.length > 0) {
            route = routeRes.rows[0];

            // 3. Get route stops in sequence order with collection zone parameters
            const stopsRes = await pool.query(
                `SELECT 
                    rs.id,
                    rs.sequence,
                    rs.status,
                    rs.expected_arrival,
                    rs.actual_arrival,
                    rs.actual_departure,
                    rs.miss_reason,
                    rs.dwell_start_time,
                    rs.last_gps_inside_at,
                    rs.scanned_count,
                    rs.verification_status,
                    cp.id AS collection_point_id,
                    cp.name,
                    cp.address,
                    cp.ward,
                    cp.latitude,
                    cp.longitude,
                    cp.scheduled_time,
                    COALESCE(cp.minimum_collection_time_seconds, 30) AS minimum_collection_time_seconds,
                    COALESCE(cp.total_scanners, 3) AS total_scanners,
                    COALESCE(cp.geofence_radius_meters, 100) AS geofence_radius_meters
                 FROM route_stops rs
                 JOIN collection_points cp ON rs.collection_point_id = cp.id
                 WHERE rs.route_id = $1
                 ORDER BY rs.sequence ASC, rs.id ASC`,
                [route.id]
            );

            // Fetch all checkpoints and scan records for each stop
            const stopDetails = [];
            for (const s of stopsRes.rows) {
                const checkpointsRes = await pool.query(
                    `SELECT 
                        sc.id,
                        sc.scanner_code,
                        sc.name,
                        sc.sequence,
                        sc.latitude,
                        sc.longitude,
                        sc.status,
                        sr.id AS scan_record_id,
                        sr.scanned_at,
                        sr.verification_status,
                        CASE WHEN sr.id IS NOT NULL AND sr.verification_status = 'VERIFIED' THEN TRUE ELSE FALSE END AS is_scanned
                     FROM scanner_checkpoints sc
                     LEFT JOIN scanner_scan_records sr 
                       ON sc.id = sr.scanner_id 
                      AND sr.route_stop_id = $1 
                      AND sr.verification_status = 'VERIFIED'
                     WHERE sc.collection_point_id = $2
                     ORDER BY sc.sequence ASC, sc.id ASC`,
                    [s.id, s.collection_point_id]
                );

                const checkpoints = checkpointsRes.rows;
                const totalCheckpoints = checkpoints.length || s.total_scanners || 3;
                const scannedCheckpoints = checkpoints.filter(c => c.is_scanned).length;

                const minCollectionSec = Number(s.minimum_collection_time_seconds) || 30;
                let elapsedDwellSec = 0;
                let isDwellCompleted = false;

                if (s.status === "COMPLETED") {
                    elapsedDwellSec = minCollectionSec;
                    isDwellCompleted = true;
                } else if (s.dwell_start_time) {
                    elapsedDwellSec = Math.max(0, Math.floor((Date.now() - new Date(s.dwell_start_time).getTime()) / 1000));
                    isDwellCompleted = elapsedDwellSec >= minCollectionSec;
                }

                let derivedZoneStatus = "NOT_STARTED";
                if (s.status === "COMPLETED") {
                    derivedZoneStatus = "COMPLETED";
                } else if (s.status === "MISSED") {
                    derivedZoneStatus = "MISSED";
                } else if (s.verification_status === "DWELL_RESET") {
                    derivedZoneStatus = "DWELL_RESET";
                } else if (isDwellCompleted && scannedCheckpoints >= totalCheckpoints) {
                    derivedZoneStatus = "READY_FOR_COMPLETION";
                } else if (s.dwell_start_time || scannedCheckpoints > 0 || s.status === "IN_PROGRESS") {
                    derivedZoneStatus = "IN_PROGRESS";
                }

                stopDetails.push({
                    id: s.id,
                    sequence: s.sequence,
                    status: s.status,
                    expected_arrival: s.expected_arrival,
                    actual_arrival: s.actual_arrival,
                    actual_departure: s.actual_departure,
                    miss_reason: s.miss_reason,
                    dwell_start_time: s.dwell_start_time,
                    elapsed_dwell_seconds: elapsedDwellSec,
                    minimum_collection_time_seconds: minCollectionSec,
                    dwell_completed: isDwellCompleted,
                    scanned_count: scannedCheckpoints,
                    total_scanners: totalCheckpoints,
                    progress_text: `${scannedCheckpoints}/${totalCheckpoints}`,
                    all_scanners_scanned: scannedCheckpoints >= totalCheckpoints && totalCheckpoints > 0,
                    zone_status: derivedZoneStatus,
                    checkpoints: checkpoints,
                    collection_point: {
                        id: s.collection_point_id,
                        name: s.name,
                        address: s.address,
                        ward: s.ward,
                        latitude: Number(s.latitude),
                        longitude: Number(s.longitude),
                        scheduled_time: s.scheduled_time || "09:00 AM",
                        minimum_collection_time_seconds: minCollectionSec,
                        total_scanners: totalCheckpoints,
                        geofence_radius_meters: s.geofence_radius_meters || 100
                    }
                });
            }

            stops = stopDetails;
        }

        // 4. Latest GPS position for vehicle
        const gpsRes = await pool.query(
            `SELECT latitude, longitude, speed, recorded_at
             FROM gps_tracking
             WHERE vehicle_id = $1
             ORDER BY recorded_at DESC
             LIMIT 1`,
            [vehicle.id]
        );

        let gps = null;
        if (gpsRes.rows.length > 0) {
            const g = gpsRes.rows[0];
            const now = new Date();
            const minutesAgo = Math.max(0, Math.round((now - new Date(g.recorded_at)) / 60000));
            gps = {
                latitude: Number(g.latitude),
                longitude: Number(g.longitude),
                speed: Number(g.speed || 0),
                recorded_at: g.recorded_at,
                last_updated: g.recorded_at,
                minutes_ago: minutesAgo
            };
        } else if (vehicle.current_latitude && vehicle.current_longitude) {
            gps = {
                latitude: Number(vehicle.current_latitude),
                longitude: Number(vehicle.current_longitude),
                speed: 0,
                recorded_at: null,
                last_updated: null,
                minutes_ago: null
            };
        }

        // 5. Identify Next Stop & calculate distance from vehicle GPS
        const nextPendingStop = stops.find(s => s.status === "PENDING") || null;
        let nextStopInfo = null;

        if (nextPendingStop) {
            let distanceToNextMeters = null;
            let isInsideGeofence = false;

            if (gps && nextPendingStop.collection_point.latitude && nextPendingStop.collection_point.longitude) {
                const { calculateHaversineDistance } = require("../services/trafficService");
                const distKm = calculateHaversineDistance(
                    gps.latitude,
                    gps.longitude,
                    nextPendingStop.collection_point.latitude,
                    nextPendingStop.collection_point.longitude
                );
                distanceToNextMeters = Math.round(distKm * 1000);
                isInsideGeofence = distanceToNextMeters <= (nextPendingStop.collection_point.geofence_radius_meters || 100);
            }

            nextStopInfo = {
                ...nextPendingStop,
                distance_from_vehicle_km: distanceToNextMeters !== null ? Number((distanceToNextMeters / 1000).toFixed(2)) : null,
                distance_from_vehicle_meters: distanceToNextMeters,
                is_inside_geofence: isInsideGeofence
            };
        }

        // 6. Progress statistics
        const completedCount = stops.filter(s => s.status === "COMPLETED").length;
        const missedCount = stops.filter(s => s.status === "MISSED").length;
        const pendingCount = stops.filter(s => s.status === "PENDING").length;

        res.json({
            vehicle: {
                id: vehicle.id,
                vehicle_number: vehicle.vehicle_number,
                status: vehicle.status,
                driver_name: vehicle.driver_name,
                driver_phone: vehicle.driver_phone,
                permanent_ward: vehicle.permanent_ward || null,
                temporary_ward: vehicle.temporary_ward || null
            },
            permanent_assigned_area: vehicle.permanent_ward || "Not Assigned",
            route: route ? {
                id: route.id,
                route_date: route.route_date,
                status: route.status,
                total_distance_km: Number(route.total_distance || 0),
                estimated_time_mins: route.estimated_time || 0
            } : null,
            stops,
            next_stop: nextStopInfo,
            summary: {
                total_stops: stops.length,
                completed_count: completedCount,
                pending_count: pendingCount,
                missed_count: missedCount,
                progress_percent: stops.length > 0 ? Math.round((completedCount / stops.length) * 100) : 0
            },
            gps
        });

    } catch (error) {
        console.error("Driver my-route fetch error:", error);
        res.status(500).json({ message: "Failed to fetch driver route", error: error.message });
    }
});

// ----------------------------------------------------
// GET /api/routes/:routeId
// ----------------------------------------------------
router.get("/:routeId", async (req, res) => {
    try {
        const { routeId } = req.params;

        const routeResult = await pool.query(
            `SELECT
                r.id,
                r.vehicle_id,
                r.route_date,
                r.status,
                r.total_distance,
                r.estimated_time,
                v.vehicle_number,
                v.status AS vehicle_status
             FROM routes r
             JOIN vehicles v
                ON r.vehicle_id = v.id
             WHERE r.id = $1`,
            [routeId]
        );

        if (routeResult.rows.length === 0) {
            return res.status(404).json({
                message: "Route not found"
            });
        }

        const stopsResult = await pool.query(
            `SELECT
                rs.id,
                rs.sequence,
                rs.status,
                rs.expected_arrival,
                rs.actual_arrival,
                rs.actual_departure,
                rs.miss_reason,
                cp.id AS collection_point_id,
                cp.name,
                cp.address,
                cp.ward,
                cp.latitude,
                cp.longitude,
                cp.scheduled_time
             FROM route_stops rs
             JOIN collection_points cp
                ON rs.collection_point_id = cp.id
             WHERE rs.route_id = $1
             ORDER BY rs.sequence ASC, rs.id ASC`,
            [routeId]
        );

        res.json({
            route: routeResult.rows[0],
            stops: stopsResult.rows
        });

    } catch (error) {
        console.error("Route fetch error:", error);
        res.status(500).json({ message: "Failed to fetch route" });
    }
});

// ----------------------------------------------------
// POST /api/routes/:routeId/optimize
// ----------------------------------------------------
router.post("/:routeId/optimize", async (req, res) => {
    try {
        const { routeId } = req.params;
        const result = await optimizeAndSaveRoute(routeId, pool);

        res.json({
            message: "Route optimized successfully",
            total_distance_km: result.totalDistance,
            estimated_time_mins: result.estimatedTotalMinutes,
            optimized_route: result.orderedPoints.map((point, index) => ({
                sequence: index + 1,
                collection_point_id: point.collectionPointId,
                name: point.name,
                address: point.address,
                latitude: point.latitude,
                longitude: point.longitude,
                distance_from_previous_km: point.distanceFromPreviousKm,
                eta: point.eta
            }))
        });

    } catch (error) {
        console.error("Route optimization error:", error);
        res.status(500).json({
            message: "Failed to optimize route",
            error: error.message
        });
    }
});

// ----------------------------------------------------
// POST /api/routes/:routeId/start
// ----------------------------------------------------
router.post("/:routeId/start", async (req, res) => {
    try {
        const { routeId } = req.params;

        const result = await pool.query(
            `UPDATE routes
             SET status = 'IN_PROGRESS'
             WHERE id = $1
             RETURNING *`,
            [routeId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Route not found"
            });
        }

        res.json({
            message: "Route started successfully",
            route: result.rows[0]
        });

    } catch (error) {
        console.error("Start route error:", error);
        res.status(500).json({ message: "Failed to start route" });
    }
});

// ----------------------------------------------------
// POST /api/routes/stops/:stopId/arrive
// Vehicle enters collection zone geofence and starts dwell timer
// ----------------------------------------------------
router.post("/stops/:stopId/arrive", async (req, res) => {
    try {
        const { stopId } = req.params;
        const { latitude, longitude, accuracy, driver_id } = req.body;

        const stopResult = await pool.query(
            `SELECT
                rs.id,
                rs.status,
                rs.dwell_start_time,
                rs.verification_status,
                cp.id AS collection_point_id,
                cp.name,
                cp.latitude,
                cp.longitude,
                COALESCE(cp.minimum_collection_time_seconds, 30) AS minimum_collection_time_seconds,
                COALESCE(cp.geofence_radius_meters, 100) AS geofence_radius_meters,
                r.vehicle_id,
                v.vehicle_number,
                v.driver_id
             FROM route_stops rs
             JOIN collection_points cp ON rs.collection_point_id = cp.id
             JOIN routes r ON rs.route_id = r.id
             JOIN vehicles v ON r.vehicle_id = v.id
             WHERE rs.id = $1`,
            [stopId]
        );

        if (stopResult.rows.length === 0) {
            return res.status(404).json({ message: "Route stop not found." });
        }

        const stop = stopResult.rows[0];

        if (stop.status === "COMPLETED") {
            return res.status(400).json({ message: `Collection at ${stop.name} is already completed.` });
        }

        if (driver_id && stop.driver_id && stop.driver_id.toString() !== driver_id.toString()) {
            return res.status(403).json({ message: "Unauthorized: Stop assigned to another vehicle/driver." });
        }

        let distanceMeters = 0;
        if (latitude !== undefined && longitude !== undefined && !isNaN(Number(latitude)) && !isNaN(Number(longitude))) {
            const { calculateHaversineDistance } = require("../services/trafficService");
            const distKm = calculateHaversineDistance(
                Number(latitude),
                Number(longitude),
                Number(stop.latitude),
                Number(stop.longitude)
            );
            distanceMeters = Math.round(distKm * 1000);

            const maxDistance = stop.geofence_radius_meters || 100;
            if (distanceMeters > maxDistance) {
                return res.status(400).json({
                    message: `Vehicle is outside the allowed collection zone. You are ${distanceMeters}m away from ${stop.name}. Must be within ${maxDistance}m.`,
                    distance_meters: distanceMeters,
                    required_distance: maxDistance
                });
            }
        }

        // Initialize dwell timer if not started or was reset
        let dwellStart = stop.dwell_start_time;
        if (!dwellStart) {
            const updRes = await pool.query(
                `UPDATE route_stops
                 SET
                    dwell_start_time = CURRENT_TIMESTAMP,
                    actual_arrival = COALESCE(actual_arrival, CURRENT_TIMESTAMP),
                    last_gps_inside_at = CURRENT_TIMESTAMP,
                    verification_status = 'IN_PROGRESS'
                 WHERE id = $1
                 RETURNING *`,
                [stopId]
            );
            dwellStart = updRes.rows[0].dwell_start_time;
        }

        const minCollectionSec = Number(stop.minimum_collection_time_seconds) || 30;
        const elapsedSec = Math.max(0, Math.floor((Date.now() - new Date(dwellStart).getTime()) / 1000));

        res.json({
            message: `Arrival confirmed at ${stop.name}. Collection timer active.`,
            stop_id: stop.id,
            zone_name: stop.name,
            dwell_start_time: dwellStart,
            elapsed_dwell_seconds: elapsedSec,
            minimum_collection_time_seconds: minCollectionSec,
            distance_meters: distanceMeters,
            is_inside_geofence: true
        });

    } catch (error) {
        console.error("Stop arrive error:", error);
        res.status(500).json({ message: "Failed to record arrival at collection zone." });
    }
});

// ----------------------------------------------------
// POST /api/routes/stops/:stopId/scan
// Scan a specific checkpoint scanner within a collection zone
// ----------------------------------------------------
router.post("/stops/:stopId/scan", async (req, res) => {
    try {
        const { stopId } = req.params;
        const { scanner_code, latitude, longitude, accuracy, driver_id, vehicle_id } = req.body;

        if (!scanner_code || scanner_code.trim() === "") {
            return res.status(400).json({ message: "scanner_code is required." });
        }

        const cleanScannerCode = scanner_code.trim().toUpperCase();

        const stopResult = await pool.query(
            `SELECT
                rs.id,
                rs.status,
                rs.route_id,
                rs.dwell_start_time,
                rs.verification_status,
                cp.id AS collection_point_id,
                cp.name,
                cp.latitude,
                cp.longitude,
                COALESCE(cp.minimum_collection_time_seconds, 30) AS minimum_collection_time_seconds,
                COALESCE(cp.total_scanners, 3) AS total_scanners,
                COALESCE(cp.geofence_radius_meters, 100) AS geofence_radius_meters,
                r.vehicle_id,
                r.route_date,
                v.vehicle_number,
                v.driver_id
             FROM route_stops rs
             JOIN collection_points cp ON rs.collection_point_id = cp.id
             JOIN routes r ON rs.route_id = r.id
             JOIN vehicles v ON r.vehicle_id = v.id
             WHERE rs.id = $1`,
            [stopId]
        );

        if (stopResult.rows.length === 0) {
            return res.status(404).json({ message: "Route stop not found." });
        }

        const stop = stopResult.rows[0];

        if (stop.status === "COMPLETED") {
            return res.status(400).json({ message: `Collection at ${stop.name} has already been completed.` });
        }

        if (driver_id && stop.driver_id && stop.driver_id.toString() !== driver_id.toString()) {
            return res.status(403).json({ message: "Unauthorized: Stop assigned to another vehicle/driver." });
        }

        // 1. GPS Geofence Check
        let distanceMeters = 0;
        if (latitude !== undefined && longitude !== undefined && !isNaN(Number(latitude)) && !isNaN(Number(longitude))) {
            const { calculateHaversineDistance } = require("../services/trafficService");
            const distKm = calculateHaversineDistance(
                Number(latitude),
                Number(longitude),
                Number(stop.latitude),
                Number(stop.longitude)
            );
            distanceMeters = Math.round(distKm * 1000);

            const maxDistance = stop.geofence_radius_meters || 100;
            if (distanceMeters > maxDistance) {
                return res.status(400).json({
                    message: `Vehicle is outside the allowed collection zone. You are ${distanceMeters}m away from ${stop.name}. Must be within ${maxDistance}m to scan.`,
                    distance_meters: distanceMeters,
                    required_distance: maxDistance
                });
            }
        }

        // 2. Validate Scanner Code belongs to this Collection Zone
        let scannerRes = await pool.query(
            `SELECT * FROM scanner_checkpoints 
             WHERE collection_point_id = $1 
               AND (UPPER(scanner_code) = $2 OR UPPER(name) = $2 OR sequence::text = $2 OR id::text = $2)`,
            [stop.collection_point_id, cleanScannerCode]
        );

        if (scannerRes.rows.length === 0) {
            // Check if it belongs to another collection zone
            const otherZoneRes = await pool.query(
                `SELECT sc.*, cp.name AS zone_name FROM scanner_checkpoints sc
                 JOIN collection_points cp ON sc.collection_point_id = cp.id
                 WHERE UPPER(sc.scanner_code) = $1 OR UPPER(sc.name) = $1 OR sc.id::text = $1`,
                [cleanScannerCode]
            );

            if (otherZoneRes.rows.length > 0) {
                const other = otherZoneRes.rows[0];
                return res.status(400).json({
                    message: `Scanner does not belong to this collection zone. (${other.scanner_code} belongs to ${other.zone_name})`
                });
            }

            return res.status(400).json({
                message: `Invalid scanner code '${scanner_code}'. Checkpoint does not exist.`
            });
        }

        const scanner = scannerRes.rows[0];

        // 3. Check duplicate scan for this route stop
        const existingScanRes = await pool.query(
            `SELECT id, scanned_at FROM scanner_scan_records 
             WHERE route_stop_id = $1 AND scanner_id = $2 AND verification_status = 'VERIFIED'`,
            [stop.id, scanner.id]
        );

        if (existingScanRes.rows.length > 0) {
            return res.status(400).json({
                message: `This checkpoint has already been scanned. (${scanner.name})`
            });
        }

        // 4. Auto-start Dwell Timer if not active
        let dwellStart = stop.dwell_start_time;
        if (!dwellStart) {
            await pool.query(
                `UPDATE route_stops
                 SET
                    dwell_start_time = CURRENT_TIMESTAMP,
                    actual_arrival = COALESCE(actual_arrival, CURRENT_TIMESTAMP),
                    last_gps_inside_at = CURRENT_TIMESTAMP,
                    verification_status = 'IN_PROGRESS'
                 WHERE id = $1`,
                [stop.id]
            );
            dwellStart = new Date().toISOString();
        }

        // 5. Insert Scan Record
        const scanLat = latitude !== undefined ? Number(latitude) : Number(scanner.latitude || stop.latitude);
        const scanLon = longitude !== undefined ? Number(longitude) : Number(scanner.longitude || stop.longitude);

        const insertScanRes = await pool.query(
            `INSERT INTO scanner_scan_records 
             (scanner_id, collection_point_id, vehicle_id, route_stop_id, route_date, scanned_at, gps_latitude, gps_longitude, distance_meters, verification_status)
             VALUES ($1, $2, $3, $4, $5::date, CURRENT_TIMESTAMP, $6, $7, $8, 'VERIFIED')
             RETURNING *`,
            [
                scanner.id,
                stop.collection_point_id,
                stop.vehicle_id,
                stop.id,
                stop.route_date || new Date().toISOString().split("T")[0],
                scanLat,
                scanLon,
                distanceMeters
            ]
        );

        // 6. Get updated counts
        const allCheckpointsRes = await pool.query(
            `SELECT 
                sc.id,
                sc.scanner_code,
                sc.name,
                sc.sequence,
                sc.status,
                sr.id AS scan_record_id,
                sr.scanned_at,
                sr.verification_status,
                CASE WHEN sr.id IS NOT NULL AND sr.verification_status = 'VERIFIED' THEN TRUE ELSE FALSE END AS is_scanned
             FROM scanner_checkpoints sc
             LEFT JOIN scanner_scan_records sr 
               ON sc.id = sr.scanner_id 
              AND sr.route_stop_id = $1 
              AND sr.verification_status = 'VERIFIED'
             WHERE sc.collection_point_id = $2
             ORDER BY sc.sequence ASC`,
            [stop.id, stop.collection_point_id]
        );

        const checkpoints = allCheckpointsRes.rows;
        const totalCount = checkpoints.length || stop.total_scanners || 3;
        const scannedCount = checkpoints.filter(c => c.is_scanned).length;

        const minCollectionSec = Number(stop.minimum_collection_time_seconds) || 30;
        const elapsedDwellSec = Math.max(0, Math.floor((Date.now() - new Date(dwellStart).getTime()) / 1000));
        const isDwellCompleted = elapsedDwellSec >= minCollectionSec;
        const allScanned = scannedCount >= totalCount;
        const readyForCompletion = allScanned && isDwellCompleted;

        // Update scanned count in route_stops
        if (readyForCompletion) {
            await pool.query(
                `UPDATE route_stops 
                 SET scanned_count = $1, last_gps_inside_at = CURRENT_TIMESTAMP, verification_status = 'VERIFIED', status = 'COMPLETED', actual_departure = CURRENT_TIMESTAMP 
                 WHERE id = $2`,
                [scannedCount, stop.id]
            );
        } else {
            await pool.query(
                `UPDATE route_stops 
                 SET scanned_count = $1, last_gps_inside_at = CURRENT_TIMESTAMP, verification_status = 'IN_PROGRESS' 
                 WHERE id = $2`,
                [scannedCount, stop.id]
            );
        }

        // Activity log
        await pool.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id)
             VALUES ($1, $2, $3)`,
            [
                'CHECKPOINT_SCANNED',
                `Scanner checkpoint verified at ${stop.name}: ${scanner.name} (${scannedCount}/${totalCount}) by vehicle ${stop.vehicle_number}.`,
                stop.vehicle_id
            ]
        );

        res.json({
            message: `✓ Checkpoint ${scanner.name} (${scanner.scanner_code}) scanned and verified successfully!`,
            scan_record: insertScanRes.rows[0],
            scanner: scanner,
            scanned_count: scannedCount,
            total_scanners: totalCount,
            progress_text: `${scannedCount}/${totalCount}`,
            dwell_start_time: dwellStart,
            elapsed_dwell_seconds: elapsedDwellSec,
            minimum_collection_time_seconds: minCollectionSec,
            dwell_completed: isDwellCompleted,
            all_scanned: allScanned,
            ready_for_completion: readyForCompletion,
            is_completed: readyForCompletion,
            checkpoints: checkpoints
        });

    } catch (error) {
        console.error("Scan checkpoint error:", error);
        res.status(500).json({ message: "Failed to verify checkpoint scanner." });
    }
});

// ----------------------------------------------------
// POST /api/routes/stops/:stopId/complete
// Complete collection zone with strict GPS geofence, scanner count, and minimum dwell time enforcement
// ----------------------------------------------------
router.post("/stops/:stopId/complete", async (req, res) => {
    try {
        const { stopId } = req.params;
        const { latitude, longitude, accuracy, driver_id } = req.body;

        if (latitude === undefined || longitude === undefined || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
            return res.status(400).json({
                message: "Current GPS location (latitude and longitude) is required."
            });
        }

        if (accuracy !== undefined && accuracy !== null && Number(accuracy) > 100) {
            return res.status(400).json({
                message: "GPS accuracy is too low. Please wait for a better GPS signal.",
                accuracy: Number(accuracy)
            });
        }

        const stopResult = await pool.query(
            `SELECT
                rs.id,
                rs.status,
                rs.route_id,
                rs.dwell_start_time,
                rs.scanned_count,
                rs.verification_status,
                cp.id AS collection_point_id,
                cp.name,
                cp.latitude,
                cp.longitude,
                COALESCE(cp.minimum_collection_time_seconds, 30) AS minimum_collection_time_seconds,
                COALESCE(cp.total_scanners, 3) AS total_scanners,
                COALESCE(cp.geofence_radius_meters, 100) AS geofence_radius_meters,
                r.vehicle_id,
                v.vehicle_number,
                v.driver_id
             FROM route_stops rs
             JOIN collection_points cp ON rs.collection_point_id = cp.id
             JOIN routes r ON rs.route_id = r.id
             JOIN vehicles v ON r.vehicle_id = v.id
             WHERE rs.id = $1`,
            [stopId]
        );

        if (stopResult.rows.length === 0) {
            return res.status(404).json({ message: "Route stop not found." });
        }

        const stop = stopResult.rows[0];

        if (stop.status === "COMPLETED") {
            return res.status(400).json({
                message: `Collection at ${stop.name} has already been completed.`
            });
        }

        if (driver_id && stop.driver_id && stop.driver_id.toString() !== driver_id.toString()) {
            return res.status(403).json({
                message: "You are not authorized to complete a stop assigned to another driver's vehicle."
            });
        }

        // 1. GPS Geofence Check
        const driverLat = Number(latitude);
        const driverLon = Number(longitude);
        const pointLat = Number(stop.latitude);
        const pointLon = Number(stop.longitude);

        const { calculateHaversineDistance } = require("../services/trafficService");
        const distKm = calculateHaversineDistance(driverLat, driverLon, pointLat, pointLon);
        const distance = Math.round(distKm * 1000);
        const maxDistance = stop.geofence_radius_meters || 100;

        if (distance > maxDistance) {
            return res.status(400).json({
                message: `Vehicle is too far from the collection zone. You are ${distance}m away from ${stop.name}. You must remain within ${maxDistance}m to complete collection.`,
                distance_meters: distance,
                required_distance: maxDistance
            });
        }

        // 2. Check All Required Scanner Checkpoints
        const totalCheckpointsRes = await pool.query(
            `SELECT COUNT(*) FROM scanner_checkpoints WHERE collection_point_id = $1`,
            [stop.collection_point_id]
        );
        const totalCheckpoints = Number(totalCheckpointsRes.rows[0].count) || stop.total_scanners || 3;

        const verifiedScansRes = await pool.query(
            `SELECT COUNT(DISTINCT scanner_id) FROM scanner_scan_records 
             WHERE route_stop_id = $1 AND verification_status = 'VERIFIED'`,
            [stop.id]
        );
        const verifiedScans = Number(verifiedScansRes.rows[0].count);

        if (verifiedScans < totalCheckpoints) {
            return res.status(400).json({
                message: `Cannot complete collection zone. Only ${verifiedScans} of ${totalCheckpoints} checkpoints have been scanned. All ${totalCheckpoints} scanner checkpoints must be verified.`,
                scanned_count: verifiedScans,
                total_scanners: totalCheckpoints,
                remaining: totalCheckpoints - verifiedScans
            });
        }

        // 3. Check Minimum Dwell / Collection Duration
        const minDwellSeconds = Number(stop.minimum_collection_time_seconds) || 30;

        if (!stop.dwell_start_time) {
            return res.status(400).json({
                message: `Collection timer has not started or was reset because the vehicle left the zone. You must remain in ${stop.name} for at least ${minDwellSeconds} seconds.`,
                minimum_collection_time_seconds: minDwellSeconds
            });
        }

        const elapsedSeconds = Math.floor((Date.now() - new Date(stop.dwell_start_time).getTime()) / 1000);

        if (elapsedSeconds < minDwellSeconds) {
            const remainingSeconds = minDwellSeconds - elapsedSeconds;
            return res.status(400).json({
                message: `Vehicle must remain in the collection zone for at least ${minDwellSeconds} seconds. Current dwell time: ${elapsedSeconds} seconds. Please wait ${remainingSeconds} more second${remainingSeconds !== 1 ? 's' : ''}.`,
                elapsed_seconds: elapsedSeconds,
                minimum_collection_time_seconds: minDwellSeconds,
                remaining_seconds: remainingSeconds
            });
        }

        // 4. Update route_stop to COMPLETED
        const result = await pool.query(
            `UPDATE route_stops
             SET
                status = 'COMPLETED',
                verification_status = 'COMPLETED',
                actual_arrival = COALESCE(actual_arrival, dwell_start_time, CURRENT_TIMESTAMP),
                actual_departure = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING *`,
            [stopId]
        );

        // Record activity log
        await pool.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id)
             VALUES ($1, $2, $3)`,
            [
                'COLLECTION_COMPLETED',
                `Collection zone ${stop.name} fully verified (${verifiedScans}/${totalCheckpoints} scanners, ${elapsedSeconds}s dwell time) by vehicle ${stop.vehicle_number}.`,
                stop.vehicle_id
            ]
        );

        res.json({
            message: `✓ Collection zone ${stop.name} verified and completed successfully! (${verifiedScans}/${totalCheckpoints} checkpoints, ${elapsedSeconds}s dwell time)`,
            distance_meters: distance,
            dwell_seconds: elapsedSeconds,
            scanned_count: verifiedScans,
            total_scanners: totalCheckpoints,
            stop: result.rows[0]
        });

    } catch (error) {
        console.error("Complete stop error:", error);
        res.status(500).json({ message: "Failed to complete collection zone." });
    }
});

// ----------------------------------------------------
// GET /api/routes/stops/:stopId/checkpoints
// Get checkpoints and scan history for a collection stop
// ----------------------------------------------------
router.get("/stops/:stopId/checkpoints", async (req, res) => {
    try {
        const { stopId } = req.params;

        const stopRes = await pool.query(
            `SELECT rs.id, rs.collection_point_id, rs.dwell_start_time, rs.status, rs.verification_status,
                    cp.name, cp.ward, cp.minimum_collection_time_seconds, cp.total_scanners, cp.geofence_radius_meters
             FROM route_stops rs
             JOIN collection_points cp ON rs.collection_point_id = cp.id
             WHERE rs.id = $1`,
            [stopId]
        );

        if (stopRes.rows.length === 0) {
            return res.status(404).json({ message: "Route stop not found." });
        }

        const stop = stopRes.rows[0];

        const checkpointsRes = await pool.query(
            `SELECT 
                sc.id,
                sc.scanner_code,
                sc.name,
                sc.sequence,
                sc.latitude,
                sc.longitude,
                sc.status,
                sr.id AS scan_record_id,
                sr.scanned_at,
                sr.verification_status,
                CASE WHEN sr.id IS NOT NULL AND sr.verification_status = 'VERIFIED' THEN TRUE ELSE FALSE END AS is_scanned
             FROM scanner_checkpoints sc
             LEFT JOIN scanner_scan_records sr 
               ON sc.id = sr.scanner_id 
              AND sr.route_stop_id = $1 
              AND sr.verification_status = 'VERIFIED'
             WHERE sc.collection_point_id = $2
             ORDER BY sc.sequence ASC`,
            [stop.id, stop.collection_point_id]
        );

        const checkpoints = checkpointsRes.rows;
        const total = checkpoints.length || stop.total_scanners || 3;
        const scanned = checkpoints.filter(c => c.is_scanned).length;

        const minCollectionSec = Number(stop.minimum_collection_time_seconds) || 30;
        let elapsedDwellSec = 0;
        if (stop.dwell_start_time) {
            elapsedDwellSec = Math.max(0, Math.floor((Date.now() - new Date(stop.dwell_start_time).getTime()) / 1000));
        }

        res.json({
            stop_id: stop.id,
            zone_name: stop.name,
            ward: stop.ward,
            status: stop.status,
            verification_status: stop.verification_status,
            dwell_start_time: stop.dwell_start_time,
            elapsed_dwell_seconds: elapsedDwellSec,
            minimum_collection_time_seconds: minCollectionSec,
            dwell_completed: elapsedDwellSec >= minCollectionSec,
            scanned_count: scanned,
            total_scanners: total,
            progress_text: `${scanned}/${total}`,
            all_scanned: scanned >= total,
            ready_for_completion: scanned >= total && elapsedDwellSec >= minCollectionSec,
            checkpoints: checkpoints
        });

    } catch (error) {
        console.error("Fetch checkpoints error:", error);
        res.status(500).json({ message: "Failed to fetch stop checkpoints." });
    }
});

// ----------------------------------------------------
// POST /api/routes/stops/:stopId/miss
// ----------------------------------------------------
router.post("/stops/:stopId/miss", async (req, res) => {
    try {
        const { stopId } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                message: "A reason is required for missing a location."
            });
        }

        const stopResult = await pool.query(
            `SELECT rs.id, rs.status, cp.name
             FROM route_stops rs
             JOIN collection_points cp ON rs.collection_point_id = cp.id
             WHERE rs.id = $1`,
            [stopId]
        );

        if (stopResult.rows.length === 0) {
            return res.status(404).json({ message: "Route stop not found." });
        }

        const stop = stopResult.rows[0];

        if (stop.status === "COMPLETED") {
            return res.status(400).json({ message: "This collection point is already completed." });
        }

        const result = await pool.query(
            `UPDATE route_stops
             SET status = 'MISSED', miss_reason = $1
             WHERE id = $2
             RETURNING *`,
            [reason.trim(), stopId]
        );

        res.json({
            message: `Collection point ${stop.name} marked as missed.`,
            stop: result.rows[0]
        });

    } catch (error) {
        console.error("Mark missed error:", error);
        res.status(500).json({ message: "Failed to mark collection point as missed." });
    }
});

// ----------------------------------------------------
// POST /api/routes/assign-locations
// Authority assigns collection points to a vehicle for an operation date.
// The System automatically checks availability, prevents duplicate assignment,
// and calculates the optimal visiting sequence.
// ----------------------------------------------------
router.post("/assign-locations", async (req, res) => {
    const client = await pool.connect();
    try {
        const { vehicle_id, collection_point_ids, route_date } = req.body;

        if (!vehicle_id || !Array.isArray(collection_point_ids)) {
            return res.status(400).json({ message: "vehicle_id and collection_point_ids array are required" });
        }

        // Deduplicate and sanitize IDs
        const uniqueCpIds = [...new Set(collection_point_ids.map(Number))].filter(id => !isNaN(id) && id > 0);

        // 1. Validate vehicle availability
        const vehRes = await client.query(
            `SELECT id, vehicle_number, status, current_latitude, current_longitude FROM vehicles WHERE id = $1`,
            [vehicle_id]
        );

        if (vehRes.rows.length === 0) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const vehicle = vehRes.rows[0];
        const vStatus = (vehicle.status || "").toUpperCase();

        if (vStatus === "MAINTENANCE" || vStatus === "INACTIVE") {
            return res.status(400).json({
                message: `Cannot assign collection points to vehicle ${vehicle.vehicle_number} because it is under ${vehicle.status}.`
            });
        }

        // Validate collection points exist
        if (uniqueCpIds.length > 0) {
            const cpCheck = await client.query(
                `SELECT id FROM collection_points WHERE id = ANY($1::int[])`,
                [uniqueCpIds]
            );
            if (cpCheck.rows.length !== uniqueCpIds.length) {
                return res.status(400).json({
                    message: "One or more selected collection points do not exist."
                });
            }
        }

        const dateStr = route_date || new Date().toISOString().split("T")[0];

        await client.query("BEGIN");

        // 2. Find or create route for target vehicle on dateStr
        let routeRes = await client.query(
            `SELECT id FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`,
            [vehicle_id, dateStr]
        );

        let routeId;
        if (routeRes.rows.length === 0) {
            const newRoute = await client.query(
                `INSERT INTO routes (vehicle_id, route_date, status, total_distance, estimated_time)
                 VALUES ($1, $2::date, 'PLANNED', 0.00, 0) RETURNING id`,
                [vehicle_id, dateStr]
            );
            routeId = newRoute.rows[0].id;
        } else {
            routeId = routeRes.rows[0].id;
        }

        // 3. Prevent duplicate assignments on this date:
        // Verify that none of the selected points are already assigned to ANOTHER vehicle for this date
        if (uniqueCpIds.length > 0) {
            const conflictCheck = await client.query(
                `SELECT rs.collection_point_id, cp.name, v.vehicle_number
                 FROM route_stops rs
                 JOIN routes r ON rs.route_id = r.id
                 JOIN vehicles v ON r.vehicle_id = v.id
                 JOIN collection_points cp ON rs.collection_point_id = cp.id
                 WHERE r.route_date = $1::date
                   AND r.id != $2
                   AND rs.collection_point_id = ANY($3::int[])
                 FOR UPDATE OF rs`,
                [dateStr, routeId, uniqueCpIds]
            );

            if (conflictCheck.rows.length > 0) {
                await client.query("ROLLBACK");
                const firstConflict = conflictCheck.rows[0];
                return res.status(409).json({
                    conflict: true,
                    message: `Collection point "${firstConflict.name}" is already assigned to vehicle ${firstConflict.vehicle_number} for this date.`,
                    conflicts: conflictCheck.rows.map(c => ({
                        collection_point_id: c.collection_point_id,
                        name: c.name,
                        assigned_to_vehicle: c.vehicle_number
                    }))
                });
            }
        }

        // 4. Update target vehicle's route_stops:
        const routeStatusRes = await client.query(`SELECT status FROM routes WHERE id = $1`, [routeId]);
        const currentRouteStatus = routeStatusRes.rows[0]?.status || 'PLANNED';

        if (currentRouteStatus === 'PLANNED') {
            await client.query(`DELETE FROM route_stops WHERE route_id = $1`, [routeId]);
        } else {
            await client.query(`DELETE FROM route_stops WHERE route_id = $1 AND status = 'PENDING'`, [routeId]);
        }

        // Insert new assigned collection points as PENDING
        for (let i = 0; i < uniqueCpIds.length; i++) {
            const cpId = uniqueCpIds[i];
            await client.query(
                `INSERT INTO route_stops (route_id, collection_point_id, sequence, status)
                 VALUES ($1, $2, $3, 'PENDING')`,
                [routeId, cpId, i + 1]
            );
        }

        // Activity log
        await client.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id) VALUES ($1, $2, $3)`,
            [
                'LOCATIONS_ASSIGNED',
                `Assigned ${uniqueCpIds.length} collection points to vehicle ${vehicle.vehicle_number} for ${dateStr}. Route optimized.`,
                vehicle_id
            ]
        );

        await client.query("COMMIT");

        // 5. System automatically optimizes route sequence
        let optResult = { orderedPoints: [], totalDistance: 0, estimatedTotalMinutes: 0 };
        if (uniqueCpIds.length > 0) {
            optResult = await optimizeAndSaveRoute(routeId, pool);
        } else {
            await pool.query(`UPDATE routes SET total_distance = 0.00, estimated_time = 0 WHERE id = $1`, [routeId]);
        }

        res.json({
            message: `${uniqueCpIds.length} collection points assigned successfully. Route optimized.`,
            route_id: routeId,
            vehicle_number: vehicle.vehicle_number,
            assigned_count: uniqueCpIds.length,
            total_distance_km: optResult.totalDistance,
            estimated_time_mins: optResult.estimatedTotalMinutes,
            optimized_route: (optResult.orderedPoints || []).map((point, index) => ({
                sequence: index + 1,
                route_stop_id: point.routeStopId,
                collection_point_id: point.collectionPointId,
                name: point.name,
                address: point.address,
                ward: point.ward,
                latitude: point.latitude,
                longitude: point.longitude,
                distance_from_previous_km: point.distanceFromPreviousKm,
                eta: point.eta
            }))
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rbErr) {
            // ignore rollback error if not in transaction
        }
        console.error("Assign locations error:", error);
        res.status(500).json({ message: "Failed to assign collection points to vehicle", error: error.message });
    } finally {
        client.release();
    }
});

// ----------------------------------------------------
// POST /api/routes/reassign-vehicle
// Authority reassigns pending stops from a vehicle entering maintenance
// to a replacement available vehicle. Destination route is automatically re-optimized.
// ----------------------------------------------------
router.post("/reassign-vehicle", async (req, res) => {
    try {
        const { from_vehicle_id, to_vehicle_id, route_date, update_from_status } = req.body;

        if (!from_vehicle_id || !to_vehicle_id) {
            return res.status(400).json({ message: "from_vehicle_id and to_vehicle_id are required" });
        }

        if (from_vehicle_id.toString() === to_vehicle_id.toString()) {
            return res.status(400).json({ message: "Source and destination vehicles must be different" });
        }

        // Validate destination vehicle
        const toVehRes = await pool.query(`SELECT id, vehicle_number, status FROM vehicles WHERE id = $1`, [to_vehicle_id]);
        if (toVehRes.rows.length === 0) {
            return res.status(404).json({ message: "Destination vehicle not found" });
        }
        const toVeh = toVehRes.rows[0];
        const toStatus = (toVeh.status || "").toUpperCase();
        if (toStatus === "MAINTENANCE" || toStatus === "INACTIVE") {
            return res.status(400).json({ message: `Destination vehicle ${toVeh.vehicle_number} is in ${toVeh.status} status and cannot receive collection points.` });
        }

        const dateStr = route_date || new Date().toISOString().split("T")[0];

        // Find source route
        const fromRouteRes = await pool.query(
            `SELECT id FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`,
            [from_vehicle_id, dateStr]
        );

        if (fromRouteRes.rows.length === 0) {
            return res.status(404).json({ message: "No route found for the source vehicle on this date." });
        }
        const fromRouteId = fromRouteRes.rows[0].id;

        // Get PENDING stops from source route
        const pendingStopsRes = await pool.query(
            `SELECT id, collection_point_id FROM route_stops WHERE route_id = $1 AND status = 'PENDING'`,
            [fromRouteId]
        );

        if (pendingStopsRes.rows.length === 0) {
            return res.status(400).json({ message: "No pending collection locations found to reassign from source vehicle." });
        }

        // Find or create destination route
        let toRouteRes = await pool.query(
            `SELECT id FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`,
            [to_vehicle_id, dateStr]
        );

        let toRouteId;
        if (toRouteRes.rows.length === 0) {
            const newRoute = await pool.query(
                `INSERT INTO routes (vehicle_id, route_date, status, total_distance, estimated_time)
                 VALUES ($1, $2::date, 'PLANNED', 0.00, 0) RETURNING id`,
                [to_vehicle_id, dateStr]
            );
            toRouteId = newRoute.rows[0].id;
        } else {
            toRouteId = toRouteRes.rows[0].id;
        }

        // Move pending stops to destination route
        for (const stop of pendingStopsRes.rows) {
            const destCheck = await pool.query(
                `SELECT id FROM route_stops WHERE route_id = $1 AND collection_point_id = $2`,
                [toRouteId, stop.collection_point_id]
            );
            if (destCheck.rows.length > 0) {
                await pool.query(`DELETE FROM route_stops WHERE id = $1`, [stop.id]);
            } else {
                await pool.query(
                    `UPDATE route_stops SET route_id = $1 WHERE id = $2`,
                    [toRouteId, stop.id]
                );
            }
        }

        // Optionally update source vehicle status (e.g. MAINTENANCE)
        if (update_from_status) {
            await pool.query(`UPDATE vehicles SET status = $1 WHERE id = $2`, [update_from_status, from_vehicle_id]);
        }

        // System automatically optimizes both routes
        const toOptResult = await optimizeAndSaveRoute(toRouteId, pool);
        await optimizeAndSaveRoute(fromRouteId, pool);

        const fromVehRes = await pool.query(`SELECT vehicle_number FROM vehicles WHERE id = $1`, [from_vehicle_id]);
        const fromNum = fromVehRes.rows[0]?.vehicle_number || `V#${from_vehicle_id}`;
        const toNum = toVeh.vehicle_number;

        await pool.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id) VALUES ($1, $2, $3)`,
            ['VEHICLE_REASSIGNED', `Reassigned ${pendingStopsRes.rows.length} collection points from ${fromNum} to ${toNum}. Route re-optimized.`, to_vehicle_id]
        );

        res.json({
            message: `Successfully reassigned ${pendingStopsRes.rows.length} collection point(s) from ${fromNum} to ${toNum}. Route optimized.`,
            reassigned_count: pendingStopsRes.rows.length,
            from_vehicle: fromNum,
            to_vehicle: toNum,
            to_route_id: toRouteId,
            total_distance_km: toOptResult.totalDistance,
            optimized_route: (toOptResult.orderedPoints || []).map((p, idx) => ({
                sequence: idx + 1,
                name: p.name,
                address: p.address,
                ward: p.ward
            }))
        });

    } catch (error) {
        console.error("Reassign vehicle error:", error);
        res.status(500).json({ message: "Failed to reassign locations to replacement vehicle", error: error.message });
    }
});

// POST /api/routes/reassign-collection-points (Alias to admin reassign)
router.post("/reassign-collection-points", async (req, res) => {
    // Forward to internal implementation
    const adminRoutes = require("./adminRoutes");
    return router.handle(req, res);
});

module.exports = router;
module.exports.optimizeAndSaveRoute = optimizeAndSaveRoute;