const pool = require("../config/db");
const { optimizeRoute } = require("./routeOptimizer");

/**
 * Optimizes route stops visiting sequence and updates total distance & estimated time
 */
async function optimizeAndSaveRoute(routeId, dbPool = pool) {
    const routeResult = await dbPool.query(
        `SELECT r.*, v.vehicle_number, v.current_latitude, v.current_longitude, v.status AS vehicle_status
         FROM routes r
         JOIN vehicles v ON r.vehicle_id = v.id
         WHERE r.id = $1`,
        [routeId]
    );

    if (routeResult.rows.length === 0) {
        return { route: null, orderedPoints: [], totalDistance: 0, estimatedTotalMinutes: 0 };
    }

    const route = routeResult.rows[0];

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
         JOIN collection_points cp ON rs.collection_point_id = cp.id
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

    // Determine start point
    let startPoint;
    if (route.current_latitude !== null && route.current_longitude !== null) {
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

    for (let i = 0; i < result.orderedPoints.length; i++) {
        await dbPool.query(
            `UPDATE route_stops SET sequence = $1 WHERE id = $2`,
            [i + 1, result.orderedPoints[i].routeStopId]
        );
    }

    const estTime = result.estimatedTotalMinutes || Math.max(Math.round(result.totalDistance * 2.4), 5);
    await dbPool.query(
        `UPDATE routes SET total_distance = $1, estimated_time = $2 WHERE id = $3`,
        [result.totalDistance.toFixed(2), estTime, routeId]
    );

    return {
        route,
        orderedPoints: result.orderedPoints,
        totalDistance: Number(result.totalDistance.toFixed(2)),
        estimatedTotalMinutes: estTime
    };
}

/**
 * Ensures that daily routes and route stops for all active permanent/temporary vehicle area assignments
 * are generated and synchronized for the given operation date.
 */
async function syncDailyRoutesForDate(targetDateStr, dbPool = pool) {
    const dateStr = targetDateStr || new Date().toISOString().split("T")[0];

    try {
        // 1. Fetch all active permanent assignments
        const permanentRes = await dbPool.query(`
            SELECT 
                vaa.id AS assignment_id,
                vaa.vehicle_id,
                vaa.ward,
                vaa.assignment_type,
                v.vehicle_number,
                v.status AS vehicle_status,
                v.driver_id,
                u.name AS driver_name
            FROM vehicle_area_assignments vaa
            JOIN vehicles v ON vaa.vehicle_id = v.id
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE
        `);

        // 2. Fetch all active temporary replacement assignments covering this date
        const tempRes = await dbPool.query(`
            SELECT 
                vaa.id AS assignment_id,
                vaa.vehicle_id,
                vaa.ward,
                vaa.assignment_type,
                vaa.replaced_vehicle_id,
                vaa.start_date,
                vaa.end_date,
                v.vehicle_number,
                v.status AS vehicle_status,
                v.driver_id,
                u.name AS driver_name
            FROM vehicle_area_assignments vaa
            JOIN vehicles v ON vaa.vehicle_id = v.id
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE vaa.assignment_type = 'TEMPORARY' 
              AND vaa.is_active = TRUE
              AND vaa.start_date <= $1::date
              AND (vaa.end_date IS NULL OR vaa.end_date >= $1::date)
        `, [dateStr]);

        const tempAssignmentsByWard = {};
        for (const t of tempRes.rows) {
            tempAssignmentsByWard[t.ward] = t;
        }

        // 3. For each permanent area assignment, determine the active operating vehicle
        for (const perm of permanentRes.rows) {
            const ward = perm.ward;
            const isPermUnderMaintenance = (perm.vehicle_status || "").toUpperCase() === "MAINTENANCE" || (perm.vehicle_status || "").toUpperCase() === "INACTIVE";
            const tempAssignment = tempAssignmentsByWard[ward];

            let effectiveVehicleId = perm.vehicle_id;
            let effectiveVehicleStatus = perm.vehicle_status;
            let isCoveredByReplacement = false;

            if (isPermUnderMaintenance && tempAssignment) {
                // Temporary replacement vehicle is active
                effectiveVehicleId = tempAssignment.vehicle_id;
                effectiveVehicleStatus = tempAssignment.vehicle_status;
                isCoveredByReplacement = true;
            }

            const effectiveIsUnavailable = (effectiveVehicleStatus || "").toUpperCase() === "MAINTENANCE" || (effectiveVehicleStatus || "").toUpperCase() === "INACTIVE";

            // If the operating vehicle is available/in-service, ensure its route & stops exist
            if (!effectiveIsUnavailable) {
                // Find or create route
                let routeRes = await dbPool.query(
                    `SELECT id, status FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`,
                    [effectiveVehicleId, dateStr]
                );

                let routeId;
                if (routeRes.rows.length === 0) {
                    const newRoute = await dbPool.query(
                        `INSERT INTO routes (vehicle_id, route_date, status, total_distance, estimated_time)
                         VALUES ($1, $2::date, 'PLANNED', 0.00, 0) RETURNING id`,
                        [effectiveVehicleId, dateStr]
                    );
                    routeId = newRoute.rows[0].id;
                } else {
                    routeId = routeRes.rows[0].id;
                }

                // Get collection points for this ward
                const cpRes = await dbPool.query(
                    `SELECT id FROM collection_points WHERE ward = $1 ORDER BY id`,
                    [ward]
                );
                const cpIds = cpRes.rows.map(r => r.id);

                // Get existing stops on this route
                const existingStopsRes = await dbPool.query(
                    `SELECT id, collection_point_id, status FROM route_stops WHERE route_id = $1`,
                    [routeId]
                );
                const existingCpIds = existingStopsRes.rows.map(s => s.collection_point_id);

                // Insert or transfer stops for this ward
                let addedAny = false;
                for (let i = 0; i < cpIds.length; i++) {
                    const cpId = cpIds[i];
                    if (!existingCpIds.includes(cpId)) {
                        // Check if collection point is already assigned to ANOTHER vehicle for this date
                        const conflictCheck = await dbPool.query(
                            `SELECT rs.id, rs.route_id, rs.status AS stop_status, r.vehicle_id 
                             FROM route_stops rs 
                             JOIN routes r ON rs.route_id = r.id 
                             WHERE r.route_date = $1::date 
                               AND r.id != $2 
                               AND rs.collection_point_id = $3`,
                            [dateStr, routeId, cpId]
                        );

                        if (conflictCheck.rows.length === 0) {
                            await dbPool.query(
                                `INSERT INTO route_stops (route_id, collection_point_id, sequence, status)
                                 VALUES ($1, $2, $3, 'PENDING')`,
                                [routeId, cpId, existingCpIds.length + i + 1]
                            );
                            addedAny = true;
                        } else {
                            // If conflicting stop belongs to a vehicle no longer servicing this ward, transfer it
                            const conflictStop = conflictCheck.rows[0];
                            const otherVehId = conflictStop.vehicle_id;
                            const isOtherStillAssigned = (perm.vehicle_id === otherVehId || tempAssignmentsByWard[ward]?.vehicle_id === otherVehId);
                            if (!isOtherStillAssigned && conflictStop.stop_status !== 'COMPLETED') {
                                await dbPool.query(
                                    `UPDATE route_stops SET route_id = $1 WHERE id = $2`,
                                    [routeId, conflictStop.id]
                                );
                                addedAny = true;
                            }
                        }
                    }
                }

                // If new stops were added, optimize sequence
                if (addedAny || existingStopsRes.rows.length === 0) {
                    await optimizeAndSaveRoute(routeId, dbPool);
                }
            } else if (isPermUnderMaintenance && !tempAssignment) {
                // Permanent vehicle is under maintenance and NO replacement assigned
                // If a route exists for this maintenance vehicle, we keep it but ensure stops reflect status
                let routeRes = await dbPool.query(
                    `SELECT id FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`,
                    [perm.vehicle_id, dateStr]
                );
                if (routeRes.rows.length > 0) {
                    const routeId = routeRes.rows[0].id;
                    await dbPool.query(`UPDATE routes SET status = 'PLANNED' WHERE id = $1`, [routeId]);
                }
            }
        }
    } catch (err) {
        console.error("Error in syncDailyRoutesForDate:", err);
    }
}

/**
 * Gets effective assignment information for a ward on a specific date
 */
async function getEffectiveAssignmentForWard(ward, targetDateStr, dbPool = pool) {
    const dateStr = targetDateStr || new Date().toISOString().split("T")[0];

    // 1. Get permanent assignment
    const permRes = await dbPool.query(`
        SELECT 
            vaa.id AS assignment_id,
            vaa.vehicle_id,
            vaa.ward,
            vaa.assignment_type,
            v.vehicle_number,
            v.status AS vehicle_status,
            v.driver_id,
            v.current_latitude,
            v.current_longitude,
            u.name AS driver_name,
            u.phone AS driver_phone
        FROM vehicle_area_assignments vaa
        JOIN vehicles v ON vaa.vehicle_id = v.id
        LEFT JOIN users u ON v.driver_id = u.id
        WHERE vaa.ward = $1 AND vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE
        LIMIT 1
    `, [ward]);

    const permanent = permRes.rows[0] || null;

    // 2. Check for temporary replacement assignment on this date
    const tempRes = await dbPool.query(`
        SELECT 
            vaa.id AS assignment_id,
            vaa.vehicle_id,
            vaa.ward,
            vaa.assignment_type,
            vaa.replaced_vehicle_id,
            vaa.start_date,
            vaa.end_date,
            v.vehicle_number,
            v.status AS vehicle_status,
            v.driver_id,
            v.current_latitude,
            v.current_longitude,
            u.name AS driver_name,
            u.phone AS driver_phone
        FROM vehicle_area_assignments vaa
        JOIN vehicles v ON vaa.vehicle_id = v.id
        LEFT JOIN users u ON v.driver_id = u.id
        WHERE vaa.ward = $1 
          AND vaa.assignment_type = 'TEMPORARY' 
          AND vaa.is_active = TRUE
          AND vaa.start_date <= $2::date
          AND (vaa.end_date IS NULL OR vaa.end_date >= $2::date)
        ORDER BY vaa.id DESC
        LIMIT 1
    `, [ward, dateStr]);

    const temporary = tempRes.rows[0] || null;

    const isPermUnderMaintenance = permanent ? (permanent.vehicle_status || "").toUpperCase() === "MAINTENANCE" : false;
    const hasReplacement = temporary !== null;

    let effectiveVehicle = permanent;
    let assignmentType = "PERMANENT";

    if (isPermUnderMaintenance && temporary) {
        effectiveVehicle = temporary;
        assignmentType = "TEMPORARY";
    }

    return {
        ward,
        date: dateStr,
        permanent_vehicle: permanent,
        is_maintenance: isPermUnderMaintenance,
        has_replacement: hasReplacement,
        replacement_vehicle: temporary,
        effective_vehicle: effectiveVehicle,
        assignment_type: assignmentType
    };
}

module.exports = {
    optimizeAndSaveRoute,
    syncDailyRoutesForDate,
    getEffectiveAssignmentForWard
};
