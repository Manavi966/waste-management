const express = require("express");
const router = express.Router();
const pool = require("../config/db");

// Authority dashboard metrics & recent activity
router.get("/dashboard", async (req, res) => {
    try {
        const { date } = req.query;

        // 1. VEHICLE SUMMARY
        const vehicleResult = await pool.query(`
            SELECT
                COUNT(*) AS total_vehicles,
                COUNT(*) FILTER (WHERE status = 'ACTIVE' OR status = 'IN_SERVICE' OR status = 'ON_ROUTE') AS active_vehicles,
                COUNT(*) FILTER (WHERE status = 'AVAILABLE') AS available_vehicles,
                COUNT(*) FILTER (WHERE status = 'INACTIVE' OR status = 'MAINTENANCE') AS inactive_vehicles
            FROM vehicles
        `);

        // 2. COLLECTION SUMMARY FOR SELECTED DATE
        const collectionResult = await pool.query(`
            SELECT
                COUNT(rs.id) AS total_stops,
                COUNT(rs.id) FILTER (WHERE rs.status = 'COMPLETED') AS completed_stops,
                COUNT(rs.id) FILTER (WHERE rs.status = 'PENDING') AS pending_stops,
                COUNT(rs.id) FILTER (WHERE rs.status = 'MISSED') AS missed_stops
            FROM route_stops rs
            JOIN routes r ON rs.route_id = r.id
            WHERE r.route_date = COALESCE($1::date, CURRENT_DATE)
        `, [date || null]);

        // 3. VEHICLE-WISE WORK STATUS
        const vehicleStatusResult = await pool.query(`
            SELECT
                v.id AS vehicle_id,
                v.vehicle_number,
                u.name AS driver_name,
                v.status AS vehicle_status,
                v.current_latitude,
                v.current_longitude,
                r.id AS route_id,
                r.route_date,
                r.status AS route_status,
                COUNT(rs.id) AS assigned,
                COUNT(rs.id) FILTER (WHERE rs.status = 'COMPLETED') AS completed,
                COUNT(rs.id) FILTER (WHERE rs.status = 'PENDING') AS pending,
                COUNT(rs.id) FILTER (WHERE rs.status = 'MISSED') AS missed
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            LEFT JOIN routes r ON r.vehicle_id = v.id AND r.route_date = COALESCE($1::date, CURRENT_DATE)
            LEFT JOIN route_stops rs ON rs.route_id = r.id
            GROUP BY v.id, v.vehicle_number, u.name, v.status, v.current_latitude, v.current_longitude, r.id, r.route_date, r.status
            ORDER BY v.vehicle_number
        `, [date || null]);

        // 4. MISSED COLLECTION LOCATIONS
        const missedResult = await pool.query(`
            SELECT
                rs.id,
                rs.sequence,
                rs.status,
                rs.miss_reason,
                cp.name AS collection_point,
                cp.address,
                r.id AS route_id,
                r.route_date,
                v.id AS vehicle_id,
                v.vehicle_number
            FROM route_stops rs
            JOIN collection_points cp ON rs.collection_point_id = cp.id
            JOIN routes r ON rs.route_id = r.id
            JOIN vehicles v ON r.vehicle_id = v.id
            WHERE rs.status = 'MISSED'
              AND r.route_date = COALESCE($1::date, CURRENT_DATE)
            ORDER BY rs.id DESC
        `, [date || null]);

        // 5. CITIZEN COMPLAINTS SUMMARY
        const complaintsResult = await pool.query(`
            SELECT
                c.id AS complaint_id,
                c.citizen_id,
                u.name AS citizen_name,
                c.collection_point_id,
                cp.name AS collection_point,
                cp.address,
                c.category,
                c.description,
                c.status,
                c.created_at
            FROM complaints c
            LEFT JOIN users u ON c.citizen_id = u.id
            LEFT JOIN collection_points cp ON c.collection_point_id = cp.id
            ORDER BY c.id DESC
            LIMIT 10
        `);

        // 6. RECENT ACTIVITY LOGS
        const recentActivityResult = await pool.query(`
            SELECT 
                al.id,
                al.event_type,
                al.description,
                al.created_at,
                v.vehicle_number
            FROM activity_logs al
            LEFT JOIN vehicles v ON al.vehicle_id = v.id
            ORDER BY al.id DESC
            LIMIT 10
        `);

        res.json({
            selected_date: date || null,
            vehicles: vehicleResult.rows[0],
            collections: collectionResult.rows[0],
            vehicle_status: vehicleStatusResult.rows,
            missed_locations: missedResult.rows,
            complaints: complaintsResult.rows,
            recent_activity: recentActivityResult.rows
        });
    } catch (error) {
        console.error("Admin dashboard error:", error);
        res.status(500).json({ message: "Failed to load authority dashboard" });
    }
});

// Reports & Analytics endpoint
router.get("/reports", async (req, res) => {
    try {
        const { start_date, end_date } = req.query;

        // 1. Overall Metrics
        const overallResult = await pool.query(`
            SELECT
                COUNT(rs.id) AS total_collections,
                COUNT(rs.id) FILTER (WHERE rs.status = 'COMPLETED') AS completed_collections,
                COUNT(rs.id) FILTER (WHERE rs.status = 'MISSED') AS missed_collections,
                COALESCE(SUM(r.total_distance), 0) AS total_distance_km
            FROM route_stops rs
            JOIN routes r ON rs.route_id = r.id
        `);

        const totalCollections = Number(overallResult.rows[0].total_collections) || 1;
        const completedCollections = Number(overallResult.rows[0].completed_collections) || 0;
        const missedCollections = Number(overallResult.rows[0].missed_collections) || 0;
        const totalDistance = Number(overallResult.rows[0].total_distance_km) || 0;

        const onTimePercent = Math.round((completedCollections / totalCollections) * 100);
        const missedPercent = Math.round((missedCollections / totalCollections) * 100);
        const estimatedWasteTons = (completedCollections * 0.5).toFixed(1); // 0.5 tons per completed stop

        // 2. Collection Trend (Last 7 days or date range)
        const trendResult = await pool.query(`
            SELECT 
                TO_CHAR(r.route_date, 'YYYY-MM-DD') AS date_label,
                COUNT(rs.id) FILTER (WHERE rs.status = 'COMPLETED') AS completed,
                COUNT(rs.id) FILTER (WHERE rs.status = 'MISSED') AS missed
            FROM routes r
            LEFT JOIN route_stops rs ON rs.route_id = r.id
            GROUP BY r.route_date
            ORDER BY r.route_date DESC
            LIMIT 14
        `);

        // 3. Waste by Ward Breakdown
        const wardResult = await pool.query(`
            SELECT 
                cp.ward,
                COUNT(rs.id) AS count
            FROM collection_points cp
            JOIN route_stops rs ON rs.collection_point_id = cp.id
            GROUP BY cp.ward
            ORDER BY count DESC
        `);

        res.json({
            metrics: {
                total_collections: totalCollections,
                total_waste_tons: Number(estimatedWasteTons),
                on_time_percent: onTimePercent,
                missed_percent: missedPercent,
                total_distance_km: Number(totalDistance.toFixed(2))
            },
            collection_trend: trendResult.rows.reverse(),
            waste_by_ward: wardResult.rows
        });
    } catch (error) {
        console.error("Reports error:", error);
        res.status(500).json({ message: "Failed to load reports" });
    }
});

// ----------------------------------------------------
// GET /api/admin/available-collection-points
// Returns available collection points, points assigned to selected vehicle, and points assigned to others for a date
// ----------------------------------------------------
router.get("/available-collection-points", async (req, res) => {
    try {
        const { date, vehicle_id, ward } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];
        const currentVehId = vehicle_id ? Number(vehicle_id) : null;

        let query = `
            SELECT 
                cp.id,
                cp.name,
                cp.address,
                cp.ward,
                cp.latitude,
                cp.longitude,
                cp.scheduled_time,
                rs.status AS stop_status,
                r.id AS route_id,
                r.vehicle_id,
                v.vehicle_number,
                CASE 
                    WHEN r.vehicle_id IS NULL THEN 'AVAILABLE'
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN 'ASSIGNED_TO_CURRENT'
                    ELSE 'ASSIGNED_TO_OTHER'
                END AS assignment_status,
                CASE 
                    WHEN r.vehicle_id IS NULL THEN true
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN true
                    ELSE false
                END AS is_available,
                CASE 
                    WHEN $2::int IS NOT NULL AND r.vehicle_id = $2::int THEN true
                    ELSE false
                END AS is_assigned_to_current,
                CASE 
                    WHEN r.vehicle_id IS NOT NULL AND ($2::int IS NULL OR r.vehicle_id != $2::int) THEN true
                    ELSE false
                END AS is_assigned_to_other
            FROM collection_points cp
            LEFT JOIN (
                SELECT rs_sub.collection_point_id, rs_sub.status, rs_sub.route_id
                FROM route_stops rs_sub
                JOIN routes r_sub ON rs_sub.route_id = r_sub.id
                WHERE r_sub.route_date = $1::date
            ) rs ON cp.id = rs.collection_point_id
            LEFT JOIN routes r ON rs.route_id = r.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
        `;
        const params = [dateStr, currentVehId];

        if (ward) {
            query += ` WHERE cp.ward = $3`;
            params.push(ward);
        }

        query += ` ORDER BY cp.id ASC`;

        const result = await pool.query(query, params);
        const rows = result.rows;

        const total = rows.length;
        const available = rows.filter(r => r.assignment_status === 'AVAILABLE').length;
        const assignedCurrent = rows.filter(r => r.assignment_status === 'ASSIGNED_TO_CURRENT').length;
        const assignedOther = rows.filter(r => r.assignment_status === 'ASSIGNED_TO_OTHER').length;
        const totalAssigned = assignedCurrent + assignedOther;

        res.json({
            date: dateStr,
            vehicle_id: currentVehId,
            counts: {
                total,
                available,
                assigned_to_current: assignedCurrent,
                assigned_to_other: assignedOther,
                total_assigned: totalAssigned
            },
            points: rows
        });
    } catch (error) {
        console.error("Admin fetch available points error:", error);
        res.status(500).json({ message: "Failed to fetch available collection points" });
    }
});

// ----------------------------------------------------
// POST /api/admin/assign-collection-points
// Transactional manual assignment of collection points to vehicle
// ----------------------------------------------------
router.post("/assign-collection-points", async (req, res) => {
    const { optimizeAndSaveRoute } = require("./routeRoutes");
    const client = await pool.connect();
    try {
        const { vehicle_id, collection_point_ids, route_date } = req.body;

        if (!vehicle_id || !Array.isArray(collection_point_ids)) {
            return res.status(400).json({ message: "vehicle_id and collection_point_ids array are required" });
        }

        const uniqueCpIds = [...new Set(collection_point_ids.map(Number))].filter(id => !isNaN(id) && id > 0);

        // 1. Validate vehicle
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

        // 2. Find or create route
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

        // 3. Prevent duplicate assignments on this date (FOR UPDATE lock)
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
                    message: `One or more selected collection points are already assigned to another vehicle for this date. (Point "${firstConflict.name}" is assigned to ${firstConflict.vehicle_number})`,
                    conflicts: conflictCheck.rows.map(c => ({
                        collection_point_id: c.collection_point_id,
                        name: c.name,
                        assigned_to_vehicle: c.vehicle_number
                    }))
                });
            }
        }

        // 4. Update route_stops
        const routeStatusRes = await client.query(`SELECT status FROM routes WHERE id = $1`, [routeId]);
        const currentRouteStatus = routeStatusRes.rows[0]?.status || 'PLANNED';

        if (currentRouteStatus === 'PLANNED') {
            await client.query(`DELETE FROM route_stops WHERE route_id = $1`, [routeId]);
        } else {
            await client.query(`DELETE FROM route_stops WHERE route_id = $1 AND status = 'PENDING'`, [routeId]);
        }

        for (let i = 0; i < uniqueCpIds.length; i++) {
            const cpId = uniqueCpIds[i];
            await client.query(
                `INSERT INTO route_stops (route_id, collection_point_id, sequence, status)
                 VALUES ($1, $2, $3, 'PENDING')`,
                [routeId, cpId, i + 1]
            );
        }

        await client.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id) VALUES ($1, $2, $3)`,
            [
                'LOCATIONS_ASSIGNED',
                `Assigned ${uniqueCpIds.length} collection points to vehicle ${vehicle.vehicle_number} for ${dateStr}.`,
                vehicle_id
            ]
        );

        await client.query("COMMIT");

        // 5. Route optimization
        let optResult = { orderedPoints: [], totalDistance: 0, estimatedTotalMinutes: 0 };
        if (uniqueCpIds.length > 0) {
            optResult = await optimizeAndSaveRoute(routeId, pool);
        } else {
            await pool.query(`UPDATE routes SET total_distance = 0.00, estimated_time = 0 WHERE id = $1`, [routeId]);
        }

        res.json({
            message: `${uniqueCpIds.length} collection points assigned to ${vehicle.vehicle_number} successfully. Route optimized.`,
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
                ward: point.ward
            }))
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rbErr) {
            // ignore rollback error
        }
        console.error("Admin assign collection points error:", error);
        res.status(500).json({ message: "Failed to assign collection points", error: error.message });
    } finally {
        client.release();
    }
});

// ----------------------------------------------------
// GET /api/admin/vehicle-assignments
// Returns all vehicles with their assigned collection points grouped for a specific date
// ----------------------------------------------------
router.get("/vehicle-assignments", async (req, res) => {
    try {
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        const vehiclesRes = await pool.query(`
            SELECT 
                v.id AS vehicle_id,
                v.vehicle_number,
                v.status AS vehicle_status,
                v.current_latitude,
                v.current_longitude,
                u.id AS driver_id,
                u.name AS driver_name,
                u.phone AS driver_phone,
                r.id AS route_id,
                r.route_date,
                r.status AS route_status,
                r.total_distance,
                r.estimated_time
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            LEFT JOIN routes r ON r.vehicle_id = v.id AND r.route_date = $1::date
            ORDER BY v.id ASC
        `, [dateStr]);

        const result = [];

        for (const veh of vehiclesRes.rows) {
            let stops = [];
            if (veh.route_id) {
                const stopsRes = await pool.query(`
                    SELECT 
                        rs.id AS route_stop_id,
                        rs.sequence,
                        rs.status AS stop_status,
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
                    JOIN collection_points cp ON rs.collection_point_id = cp.id
                    WHERE rs.route_id = $1
                    ORDER BY rs.sequence ASC, rs.id ASC
                `, [veh.route_id]);
                stops = stopsRes.rows;
            }

            result.push({
                ...veh,
                stops,
                total_stops: stops.length,
                pending_stops: stops.filter(s => s.stop_status === "PENDING"),
                completed_stops: stops.filter(s => s.stop_status === "COMPLETED"),
                missed_stops: stops.filter(s => s.stop_status === "MISSED")
            });
        }

        res.json({
            date: dateStr,
            vehicles: result
        });
    } catch (error) {
        console.error("Fetch vehicle assignments error:", error);
        res.status(500).json({ message: "Failed to fetch vehicle assignments", error: error.message });
    }
});

// ----------------------------------------------------
// POST /api/admin/reassign-collection-points
// Transactional reassignment of specific collection points from one vehicle to another
// ----------------------------------------------------
router.post("/reassign-collection-points", async (req, res) => {
    const { optimizeAndSaveRoute } = require("./routeRoutes");
    const client = await pool.connect();
    try {
        const {
            source_vehicle_id,
            destination_vehicle_id,
            collection_point_ids,
            route_date
        } = req.body;

        if (!source_vehicle_id || !destination_vehicle_id) {
            return res.status(400).json({ message: "source_vehicle_id and destination_vehicle_id are required." });
        }

        if (source_vehicle_id.toString() === destination_vehicle_id.toString()) {
            return res.status(400).json({ message: "Source and destination vehicles must be different." });
        }

        if (!Array.isArray(collection_point_ids) || collection_point_ids.length === 0) {
            return res.status(400).json({ message: "Please select at least one collection point to reassign." });
        }

        const uniqueCpIds = [...new Set(collection_point_ids.map(Number))].filter(id => !isNaN(id) && id > 0);
        if (uniqueCpIds.length === 0) {
            return res.status(400).json({ message: "Invalid collection point IDs provided." });
        }

        const dateStr = route_date || new Date().toISOString().split("T")[0];

        // 1. Validate Source Vehicle
        const srcVehRes = await client.query(
            `SELECT id, vehicle_number, status FROM vehicles WHERE id = $1`,
            [source_vehicle_id]
        );
        if (srcVehRes.rows.length === 0) {
            return res.status(404).json({ message: "Source vehicle not found." });
        }
        const srcVeh = srcVehRes.rows[0];

        // 2. Validate Destination Vehicle
        const destVehRes = await client.query(
            `SELECT id, vehicle_number, status FROM vehicles WHERE id = $1`,
            [destination_vehicle_id]
        );
        if (destVehRes.rows.length === 0) {
            return res.status(404).json({ message: "Destination vehicle not found." });
        }
        const destVeh = destVehRes.rows[0];
        const destStatus = (destVeh.status || "").toUpperCase();

        if (destStatus === "MAINTENANCE" || destStatus === "INACTIVE") {
            return res.status(400).json({
                message: `Selected vehicle ${destVeh.vehicle_number} is under ${destVeh.status} and cannot receive collection points.`
            });
        }

        await client.query("BEGIN");

        // 3. Find Source Route for dateStr
        const srcRouteRes = await client.query(
            `SELECT id, status FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`,
            [source_vehicle_id, dateStr]
        );
        if (srcRouteRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: `No active route found for vehicle ${srcVeh.vehicle_number} on ${dateStr}.` });
        }
        const srcRouteId = srcRouteRes.rows[0].id;

        // 4. Verify selected collection points belong to source route
        const selectedStopsRes = await client.query(
            `SELECT rs.id, rs.collection_point_id, rs.status, cp.name AS point_name
             FROM route_stops rs
             JOIN collection_points cp ON rs.collection_point_id = cp.id
             WHERE rs.route_id = $1 AND rs.collection_point_id = ANY($2::int[])
             FOR UPDATE OF rs`,
            [srcRouteId, uniqueCpIds]
        );

        if (selectedStopsRes.rows.length !== uniqueCpIds.length) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                message: "One or more selected collection points are not assigned to this vehicle."
            });
        }

        // 5. Prevent completed collection points from being reassigned
        const completedStops = selectedStopsRes.rows.filter(s => s.status === "COMPLETED");
        if (completedStops.length > 0) {
            await client.query("ROLLBACK");
            const names = completedStops.map(s => s.point_name).join(", ");
            return res.status(400).json({
                message: `Completed collection points cannot be reassigned: ${names}`
            });
        }

        // 6. Find or create destination route
        let destRouteRes = await client.query(
            `SELECT id FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`,
            [destination_vehicle_id, dateStr]
        );
        let destRouteId;
        if (destRouteRes.rows.length === 0) {
            const newRoute = await client.query(
                `INSERT INTO routes (vehicle_id, route_date, status, total_distance, estimated_time)
                 VALUES ($1, $2::date, 'PLANNED', 0.00, 0) RETURNING id`,
                [destination_vehicle_id, dateStr]
            );
            destRouteId = newRoute.rows[0].id;
        } else {
            destRouteId = destRouteRes.rows[0].id;
        }

        // 7. Check if any selected point already exists on destination route (or another vehicle's route on that date)
        const conflictRes = await client.query(
            `SELECT rs.collection_point_id, cp.name, v.vehicle_number
             FROM route_stops rs
             JOIN routes r ON rs.route_id = r.id
             JOIN vehicles v ON r.vehicle_id = v.id
             JOIN collection_points cp ON rs.collection_point_id = cp.id
             WHERE r.route_date = $1::date
               AND r.id != $2
               AND r.id != $3
               AND rs.collection_point_id = ANY($4::int[])`,
            [dateStr, srcRouteId, destRouteId, uniqueCpIds]
        );

        if (conflictRes.rows.length > 0) {
            await client.query("ROLLBACK");
            const conf = conflictRes.rows[0];
            return res.status(409).json({
                message: `Collection point "${conf.name}" is already assigned to vehicle ${conf.vehicle_number} for this date.`
            });
        }

        // 8. Atomic move of route_stops to destination route
        for (const stop of selectedStopsRes.rows) {
            // Check if already present on dest route
            const destStopCheck = await client.query(
                `SELECT id FROM route_stops WHERE route_id = $1 AND collection_point_id = $2`,
                [destRouteId, stop.collection_point_id]
            );

            if (destStopCheck.rows.length > 0) {
                // Remove from source if already on destination
                await client.query(`DELETE FROM route_stops WHERE id = $1`, [stop.id]);
            } else {
                // Move stop to destination route (set status to PENDING if reassigned)
                await client.query(
                    `UPDATE route_stops 
                     SET route_id = $1, 
                         status = 'PENDING',
                         actual_arrival = NULL,
                         actual_departure = NULL
                     WHERE id = $2`,
                    [destRouteId, stop.id]
                );
            }
        }

        // 9. Audit logging into activity_logs
        const pointNames = selectedStopsRes.rows.map(s => s.point_name).join(", ");
        await client.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id)
             VALUES ($1, $2, $3)`,
            [
                'POINTS_REASSIGNED',
                `Reassigned ${uniqueCpIds.length} collection point(s) (${pointNames}) from ${srcVeh.vehicle_number} to ${destVeh.vehicle_number} for ${dateStr}.`,
                destination_vehicle_id
            ]
        );

        await client.query("COMMIT");

        // 10. Re-optimize both routes
        const srcOpt = await optimizeAndSaveRoute(srcRouteId, pool);
        const destOpt = await optimizeAndSaveRoute(destRouteId, pool);

        res.json({
            message: `Successfully reassigned ${uniqueCpIds.length} collection point(s) from ${srcVeh.vehicle_number} to ${destVeh.vehicle_number}. Route sequences re-optimized.`,
            reassigned_count: uniqueCpIds.length,
            reassigned_points: selectedStopsRes.rows.map(s => ({ id: s.collection_point_id, name: s.point_name })),
            source_vehicle: srcVeh.vehicle_number,
            destination_vehicle: destVeh.vehicle_number,
            destination_total_distance_km: destOpt.totalDistance,
            destination_estimated_time_mins: destOpt.estimatedTotalMinutes,
            source_total_distance_km: srcOpt.totalDistance,
            source_estimated_time_mins: srcOpt.estimatedTotalMinutes
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rbErr) {
            // ignore rollback error
        }
        console.error("Reassign collection points error:", error);
        res.status(500).json({ message: "Failed to reassign collection points", error: error.message });
    } finally {
        client.release();
    }
});

module.exports = router;