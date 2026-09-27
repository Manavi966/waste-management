const express = require("express");
const router = express.Router();
const pool = require("../config/db");
const { syncDailyRoutesForDate, optimizeAndSaveRoute } = require("../services/dailyOperationService");
const { handleReplacementAssignedEvent } = require("../services/notificationService");

// Authority dashboard metrics & recent activity & maintenance alerts
router.get("/dashboard", async (req, res) => {
    try {
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        // 0. Auto-sync daily routes from permanent and temporary assignments
        await syncDailyRoutesForDate(dateStr);

        // 1. VEHICLE SUMMARY
        const vehicleResult = await pool.query(`
            SELECT
                COUNT(*) AS total_vehicles,
                COUNT(*) FILTER (WHERE status = 'ACTIVE' OR status = 'IN_SERVICE' OR status = 'ON_ROUTE') AS active_vehicles,
                COUNT(*) FILTER (WHERE status = 'AVAILABLE') AS available_vehicles,
                COUNT(*) FILTER (WHERE status = 'INACTIVE' OR status = 'MAINTENANCE') AS inactive_vehicles
            FROM vehicles
        `);

        // 1.5 MASTER COLLECTION POINTS SUMMARY
        const cpMasterResult = await pool.query(`SELECT COUNT(*) AS total_collection_points FROM collection_points`);

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
        `, [dateStr]);

        // 3. VEHICLE-WISE WORK STATUS (with permanent & temporary ward information)
        const vehicleStatusResult = await pool.query(`
            SELECT
                v.id AS vehicle_id,
                v.vehicle_number,
                u.name AS driver_name,
                v.status AS vehicle_status,
                v.current_latitude,
                v.current_longitude,
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
                      AND vaa.start_date <= $1::date 
                      AND (vaa.end_date IS NULL OR vaa.end_date >= $1::date)
                    ORDER BY vaa.id DESC 
                    LIMIT 1
                ) AS temporary_ward,
                r.id AS route_id,
                r.route_date,
                r.status AS route_status,
                COUNT(rs.id) AS assigned,
                COUNT(rs.id) FILTER (WHERE rs.status = 'COMPLETED') AS completed,
                COUNT(rs.id) FILTER (WHERE rs.status = 'PENDING') AS pending,
                COUNT(rs.id) FILTER (WHERE rs.status = 'MISSED') AS missed
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            LEFT JOIN routes r ON r.vehicle_id = v.id AND r.route_date = $1::date
            LEFT JOIN route_stops rs ON rs.route_id = r.id
            GROUP BY v.id, v.vehicle_number, u.name, v.status, v.current_latitude, v.current_longitude, r.id, r.route_date, r.status
            ORDER BY v.vehicle_number
        `, [dateStr]);

        // 4. MISSED COLLECTION LOCATIONS
        const missedResult = await pool.query(`
            SELECT
                rs.id,
                rs.sequence,
                rs.status,
                rs.miss_reason,
                cp.name AS collection_point,
                cp.address,
                cp.ward,
                r.id AS route_id,
                r.route_date,
                v.id AS vehicle_id,
                v.vehicle_number
            FROM route_stops rs
            JOIN collection_points cp ON rs.collection_point_id = cp.id
            JOIN routes r ON rs.route_id = r.id
            JOIN vehicles v ON r.vehicle_id = v.id
            WHERE rs.status = 'MISSED'
              AND r.route_date = $1::date
            ORDER BY rs.id DESC
        `, [dateStr]);

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

        // 7. MAINTENANCE ALERTS & REPLACEMENT ASSIGNMENT STATUS
        const maintenanceVehiclesRes = await pool.query(`
            SELECT 
                v.id AS vehicle_id,
                v.vehicle_number,
                v.status,
                u.name AS driver_name,
                (
                    SELECT vaa.ward 
                    FROM vehicle_area_assignments vaa 
                    WHERE vaa.vehicle_id = v.id 
                      AND vaa.assignment_type = 'PERMANENT' 
                      AND vaa.is_active = TRUE 
                    LIMIT 1
                ) AS affected_area,
                -- Check if temporary replacement is assigned for this date
                (
                    SELECT vaa_rep.id 
                    FROM vehicle_area_assignments vaa_rep 
                    WHERE vaa_rep.replaced_vehicle_id = v.id 
                      AND vaa_rep.assignment_type = 'TEMPORARY' 
                      AND vaa_rep.is_active = TRUE 
                      AND vaa_rep.start_date <= $1::date 
                      AND (vaa_rep.end_date IS NULL OR vaa_rep.end_date >= $1::date)
                    ORDER BY vaa_rep.id DESC 
                    LIMIT 1
                ) AS replacement_assignment_id,
                (
                    SELECT v_rep.vehicle_number 
                    FROM vehicle_area_assignments vaa_rep 
                    JOIN vehicles v_rep ON vaa_rep.vehicle_id = v_rep.id
                    WHERE vaa_rep.replaced_vehicle_id = v.id 
                      AND vaa_rep.assignment_type = 'TEMPORARY' 
                      AND vaa_rep.is_active = TRUE 
                      AND vaa_rep.start_date <= $1::date 
                      AND (vaa_rep.end_date IS NULL OR vaa_rep.end_date >= $1::date)
                    ORDER BY vaa_rep.id DESC 
                    LIMIT 1
                ) AS replacement_vehicle_number,
                (
                    SELECT v_rep.id 
                    FROM vehicle_area_assignments vaa_rep 
                    JOIN vehicles v_rep ON vaa_rep.vehicle_id = v_rep.id
                    WHERE vaa_rep.replaced_vehicle_id = v.id 
                      AND vaa_rep.assignment_type = 'TEMPORARY' 
                      AND vaa_rep.is_active = TRUE 
                      AND vaa_rep.start_date <= $1::date 
                      AND (vaa_rep.end_date IS NULL OR vaa_rep.end_date >= $1::date)
                    ORDER BY vaa_rep.id DESC 
                    LIMIT 1
                ) AS replacement_vehicle_id
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE v.status = 'MAINTENANCE'
            ORDER BY v.id ASC
        `, [dateStr]);

        // Eligible replacement vehicles: not in MAINTENANCE, not INACTIVE, not OUT_OF_SERVICE
        const eligibleVehiclesRes = await pool.query(`
            SELECT 
                v.id,
                v.vehicle_number,
                v.status,
                u.name AS driver_name,
                (
                    SELECT vaa.ward 
                    FROM vehicle_area_assignments vaa 
                    WHERE vaa.vehicle_id = v.id 
                      AND vaa.assignment_type = 'PERMANENT' 
                      AND vaa.is_active = TRUE 
                    LIMIT 1
                ) AS permanent_ward
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE v.status NOT IN ('MAINTENANCE', 'INACTIVE', 'OUT_OF_SERVICE')
            ORDER BY v.id ASC
        `);

        const maintenanceAlerts = maintenanceVehiclesRes.rows.map(mv => ({
            vehicle_id: mv.vehicle_id,
            vehicle_number: mv.vehicle_number,
            driver_name: mv.driver_name || "Unassigned",
            status: mv.status,
            affected_area: mv.affected_area || "General",
            collection_status: "Affected",
            replacement_assigned: Boolean(mv.replacement_assignment_id),
            replacement_vehicle: mv.replacement_vehicle_number ? {
                id: mv.replacement_vehicle_id,
                vehicle_number: mv.replacement_vehicle_number
            } : null
        }));

        res.json({
            selected_date: dateStr,
            total_collection_points: Number(cpMasterResult.rows[0]?.total_collection_points || 0),
            vehicles: vehicleResult.rows[0],
            collections: collectionResult.rows[0],
            vehicle_status: vehicleStatusResult.rows,
            missed_locations: missedResult.rows,
            complaints: complaintsResult.rows,
            recent_activity: recentActivityResult.rows,
            maintenance_alerts: maintenanceAlerts,
            eligible_replacements: eligibleVehiclesRes.rows
        });
    } catch (error) {
        console.error("Admin dashboard error:", error);
        res.status(500).json({ message: "Failed to load authority dashboard" });
    }
});

// GET /api/admin/maintenance-alerts - Dedicated endpoint for maintenance alerts
router.get("/maintenance-alerts", async (req, res) => {
    try {
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        const maintenanceVehiclesRes = await pool.query(`
            SELECT 
                v.id AS vehicle_id,
                v.vehicle_number,
                v.status,
                u.name AS driver_name,
                u.phone AS driver_phone,
                (
                    SELECT vaa.ward 
                    FROM vehicle_area_assignments vaa 
                    WHERE vaa.vehicle_id = v.id 
                      AND vaa.assignment_type = 'PERMANENT' 
                      AND vaa.is_active = TRUE 
                    LIMIT 1
                ) AS affected_area,
                (
                    SELECT vaa_rep.id 
                    FROM vehicle_area_assignments vaa_rep 
                    WHERE vaa_rep.replaced_vehicle_id = v.id 
                      AND vaa_rep.assignment_type = 'TEMPORARY' 
                      AND vaa_rep.is_active = TRUE 
                      AND vaa_rep.start_date <= $1::date 
                      AND (vaa_rep.end_date IS NULL OR vaa_rep.end_date >= $1::date)
                    ORDER BY vaa_rep.id DESC 
                    LIMIT 1
                ) AS replacement_assignment_id,
                (
                    SELECT v_rep.vehicle_number 
                    FROM vehicle_area_assignments vaa_rep 
                    JOIN vehicles v_rep ON vaa_rep.vehicle_id = v_rep.id
                    WHERE vaa_rep.replaced_vehicle_id = v.id 
                      AND vaa_rep.assignment_type = 'TEMPORARY' 
                      AND vaa_rep.is_active = TRUE 
                      AND vaa_rep.start_date <= $1::date 
                      AND (vaa_rep.end_date IS NULL OR vaa_rep.end_date >= $1::date)
                    ORDER BY vaa_rep.id DESC 
                    LIMIT 1
                ) AS replacement_vehicle_number,
                (
                    SELECT v_rep.id 
                    FROM vehicle_area_assignments vaa_rep 
                    JOIN vehicles v_rep ON vaa_rep.vehicle_id = v_rep.id
                    WHERE vaa_rep.replaced_vehicle_id = v.id 
                      AND vaa_rep.assignment_type = 'TEMPORARY' 
                      AND vaa_rep.is_active = TRUE 
                      AND vaa_rep.start_date <= $1::date 
                      AND (vaa_rep.end_date IS NULL OR vaa_rep.end_date >= $1::date)
                    ORDER BY vaa_rep.id DESC 
                    LIMIT 1
                ) AS replacement_vehicle_id
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE v.status = 'MAINTENANCE'
            ORDER BY v.id ASC
        `, [dateStr]);

        const eligibleVehiclesRes = await pool.query(`
            SELECT 
                v.id,
                v.vehicle_number,
                v.status,
                u.name AS driver_name,
                (
                    SELECT vaa.ward 
                    FROM vehicle_area_assignments vaa 
                    WHERE vaa.vehicle_id = v.id 
                      AND vaa.assignment_type = 'PERMANENT' 
                      AND vaa.is_active = TRUE 
                    LIMIT 1
                ) AS permanent_ward
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE v.status NOT IN ('MAINTENANCE', 'INACTIVE', 'OUT_OF_SERVICE')
            ORDER BY v.id ASC
        `);

        res.json({
            date: dateStr,
            maintenance_vehicles: maintenanceVehiclesRes.rows.map(mv => ({
                vehicle_id: mv.vehicle_id,
                vehicle_number: mv.vehicle_number,
                driver_name: mv.driver_name || "Unassigned",
                driver_phone: mv.driver_phone,
                status: mv.status,
                affected_area: mv.affected_area || "General",
                today_collection: "Affected",
                replacement_assigned: Boolean(mv.replacement_assignment_id),
                replacement_assignment_id: mv.replacement_assignment_id,
                replacement_vehicle: mv.replacement_vehicle_number ? {
                    id: mv.replacement_vehicle_id,
                    vehicle_number: mv.replacement_vehicle_number
                } : null
            })),
            eligible_replacement_vehicles: eligibleVehiclesRes.rows
        });
    } catch (error) {
        console.error("Fetch maintenance alerts error:", error);
        res.status(500).json({ message: "Failed to fetch maintenance alerts" });
    }
});

// POST /api/admin/assign-replacement - Authority decides and assigns replacement vehicle for an affected area
router.post("/assign-replacement", async (req, res) => {
    try {
        const {
            maintenance_vehicle_id,
            replacement_vehicle_id,
            ward,
            start_date,
            end_date
        } = req.body;

        if (!maintenance_vehicle_id || !replacement_vehicle_id) {
            return res.status(400).json({ message: "maintenance_vehicle_id and replacement_vehicle_id are required." });
        }

        if (maintenance_vehicle_id.toString() === replacement_vehicle_id.toString()) {
            return res.status(400).json({ message: "Maintenance vehicle and replacement vehicle cannot be the same." });
        }

        const dateStr = start_date || new Date().toISOString().split("T")[0];

        // 1. Validate Maintenance Vehicle
        const maintRes = await pool.query(`SELECT id, vehicle_number, status FROM vehicles WHERE id = $1`, [maintenance_vehicle_id]);
        if (maintRes.rows.length === 0) {
            return res.status(404).json({ message: "Maintenance vehicle not found." });
        }
        const maintVeh = maintRes.rows[0];

        // 2. Validate Replacement Vehicle
        const repRes = await pool.query(`SELECT id, vehicle_number, status FROM vehicles WHERE id = $1`, [replacement_vehicle_id]);
        if (repRes.rows.length === 0) {
            return res.status(404).json({ message: "Replacement vehicle not found." });
        }
        const repVeh = repRes.rows[0];
        const repStatus = (repVeh.status || "").toUpperCase();

        if (repStatus === "MAINTENANCE" || repStatus === "INACTIVE" || repStatus === "OUT_OF_SERVICE") {
            return res.status(400).json({
                message: `Selected vehicle ${repVeh.vehicle_number} is under ${repVeh.status} and cannot be assigned as a replacement.`
            });
        }

        // 3. Resolve Ward / Area
        let targetWard = ward;
        if (!targetWard) {
            const wardRes = await pool.query(
                `SELECT ward FROM vehicle_area_assignments WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT' AND is_active = TRUE LIMIT 1`,
                [maintenance_vehicle_id]
            );
            targetWard = wardRes.rows[0]?.ward;
        }

        if (!targetWard) {
            return res.status(400).json({ message: "Could not identify affected area for this vehicle. Please specify ward." });
        }

        // 4. Deactivate any prior temporary replacement for this ward
        await pool.query(
            `UPDATE vehicle_area_assignments
             SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
             WHERE ward = $1 AND assignment_type = 'TEMPORARY' AND is_active = TRUE`,
            [targetWard]
        );

        // 5. Create TEMPORARY Assignment
        const insertRes = await pool.query(
            `INSERT INTO vehicle_area_assignments 
             (vehicle_id, ward, assignment_type, start_date, end_date, is_active, replaced_vehicle_id, notes)
             VALUES ($1, $2, 'TEMPORARY', $3::date, $4, TRUE, $5, $6)
             RETURNING *`,
            [
                replacement_vehicle_id,
                targetWard,
                dateStr,
                end_date ? end_date : null,
                maintenance_vehicle_id,
                `Temporary replacement for ${maintVeh.vehicle_number} in ${targetWard}`
            ]
        );

        // 6. Handle Notifications (Citizen & Authority alerts)
        await handleReplacementAssignedEvent({
            maintenanceVehicleId: maintenance_vehicle_id,
            maintenanceVehicleNumber: maintVeh.vehicle_number,
            replacementVehicleId: replacement_vehicle_id,
            replacementVehicleNumber: repVeh.vehicle_number,
            ward: targetWard,
            startDate: dateStr,
            endDate: end_date
        }, pool);

        // 7. Auto-sync routes so replacement vehicle is populated with targetWard's collection points
        await syncDailyRoutesForDate(dateStr, pool);

        res.json({
            message: `Replacement vehicle ${repVeh.vehicle_number} successfully assigned to cover ${targetWard} temporarily. Notifications dispatched.`,
            temporary_assignment: insertRes.rows[0],
            replacement_vehicle: repVeh.vehicle_number,
            maintenance_vehicle: maintVeh.vehicle_number,
            ward: targetWard
        });
    } catch (error) {
        console.error("Assign replacement vehicle error:", error);
        res.status(500).json({ message: "Failed to assign replacement vehicle", error: error.message });
    }
});

// POST /api/admin/remove-replacement - End temporary replacement assignment
router.post("/remove-replacement", async (req, res) => {
    try {
        const { assignment_id, ward } = req.body;

        if (assignment_id) {
            await pool.query(
                `UPDATE vehicle_area_assignments SET is_active = FALSE, end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [assignment_id]
            );
        } else if (ward) {
            await pool.query(
                `UPDATE vehicle_area_assignments SET is_active = FALSE, end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE ward = $1 AND assignment_type = 'TEMPORARY' AND is_active = TRUE`,
                [ward]
            );
        } else {
            return res.status(400).json({ message: "assignment_id or ward is required." });
        }

        await syncDailyRoutesForDate(new Date().toISOString().split("T")[0], pool);

        res.json({ message: "Temporary replacement assignment ended successfully." });
    } catch (error) {
        console.error("Remove replacement error:", error);
        res.status(500).json({ message: "Failed to end replacement assignment." });
    }
});

// GET /api/admin/ward-overview - Overview of all wards with permanent vehicles, points, and operating status
router.get("/ward-overview", async (req, res) => {
    try {
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        await syncDailyRoutesForDate(dateStr, pool);

        // Canonical wards from collection points
        const wardRows = await pool.query(`
            SELECT DISTINCT ward FROM collection_points WHERE ward IS NOT NULL ORDER BY ward ASC
        `);

        // Fetch all collection points grouped by ward
        const pointsRes = await pool.query(`
            SELECT id, name, address, ward, latitude, longitude, scheduled_time
            FROM collection_points
            ORDER BY id ASC
        `);

        const pointsByWard = {};
        for (const pt of pointsRes.rows) {
            if (!pointsByWard[pt.ward]) pointsByWard[pt.ward] = [];
            pointsByWard[pt.ward].push(pt);
        }

        // Fetch all active permanent assignments
        const permRes = await pool.query(`
            SELECT 
                vaa.id AS assignment_id,
                vaa.ward,
                vaa.vehicle_id,
                vaa.start_date,
                v.vehicle_number,
                v.status AS vehicle_status,
                u.id AS driver_id,
                u.name AS driver_name,
                u.phone AS driver_phone
            FROM vehicle_area_assignments vaa
            JOIN vehicles v ON vaa.vehicle_id = v.id
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE
        `);

        const permByWard = {};
        for (const p of permRes.rows) {
            permByWard[p.ward] = p;
        }

        // Fetch temporary replacement assignments for this date
        const tempRes = await pool.query(`
            SELECT 
                vaa.id AS assignment_id,
                vaa.ward,
                vaa.vehicle_id,
                vaa.start_date,
                vaa.end_date,
                vaa.replaced_vehicle_id,
                v.vehicle_number,
                v.status AS vehicle_status,
                u.id AS driver_id,
                u.name AS driver_name,
                u.phone AS driver_phone,
                v_rep.vehicle_number AS regular_vehicle_number
            FROM vehicle_area_assignments vaa
            JOIN vehicles v ON vaa.vehicle_id = v.id
            LEFT JOIN users u ON v.driver_id = u.id
            LEFT JOIN vehicles v_rep ON vaa.replaced_vehicle_id = v_rep.id
            WHERE vaa.assignment_type = 'TEMPORARY' 
              AND vaa.is_active = TRUE
              AND vaa.start_date <= $1::date
              AND (vaa.end_date IS NULL OR vaa.end_date >= $1::date)
        `, [dateStr]);

        const tempByWard = {};
        for (const t of tempRes.rows) {
            tempByWard[t.ward] = t;
        }

        const wardOverview = wardRows.rows.map(wRow => {
            const ward = wRow.ward;
            const points = pointsByWard[ward] || [];
            const perm = permByWard[ward] || null;
            const temp = tempByWard[ward] || null;

            const isMaint = perm ? (perm.vehicle_status === "MAINTENANCE" || perm.vehicle_status === "INACTIVE") : false;
            const hasReplacement = Boolean(temp);

            let opStatus = "NORMAL";
            if (!perm) {
                opStatus = "UNASSIGNED";
            } else if (isMaint && !hasReplacement) {
                opStatus = "MAINTENANCE_NO_REPLACEMENT";
            } else if (isMaint && hasReplacement) {
                opStatus = "TEMPORARY_REPLACEMENT_ACTIVE";
            }

            const activeVeh = hasReplacement ? {
                id: temp.vehicle_id,
                vehicle_number: temp.vehicle_number,
                status: temp.vehicle_status,
                driver_name: temp.driver_name || "Unassigned",
                driver_phone: temp.driver_phone,
                is_replacement: true,
                regular_vehicle_number: temp.regular_vehicle_number
            } : perm ? {
                id: perm.vehicle_id,
                vehicle_number: perm.vehicle_number,
                status: perm.vehicle_status,
                driver_name: perm.driver_name || "Unassigned",
                driver_phone: perm.driver_phone,
                is_replacement: false
            } : null;

            return {
                ward,
                collection_points: points,
                total_points: points.length,
                permanent_vehicle: perm,
                temporary_vehicle: temp,
                is_maintenance: isMaint,
                has_replacement: hasReplacement,
                operating_status: opStatus,
                active_vehicle: activeVeh
            };
        });

        // Vehicles available for permanent assignment
        const allVehiclesRes = await pool.query(`
            SELECT 
                v.id,
                v.vehicle_number,
                v.status,
                u.name AS driver_name,
                (
                    SELECT vaa.ward 
                    FROM vehicle_area_assignments vaa 
                    WHERE vaa.vehicle_id = v.id 
                      AND vaa.assignment_type = 'PERMANENT' 
                      AND vaa.is_active = TRUE 
                    LIMIT 1
                ) AS permanent_ward
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            ORDER BY v.id ASC
        `);

        // Eligible vehicles for replacement
        const eligibleReplacements = allVehiclesRes.rows.filter(
            v => v.status !== "MAINTENANCE" && v.status !== "INACTIVE" && v.status !== "OUT_OF_SERVICE"
        );

        res.json({
            date: dateStr,
            wards: wardOverview,
            vehicles: allVehiclesRes.rows,
            eligible_replacements: eligibleReplacements
        });
    } catch (error) {
        console.error("Ward overview error:", error);
        res.status(500).json({ message: "Failed to load ward overview" });
    }
});

// GET /api/admin/areas - Returns all distinct areas/wards and their collection points, with assignment status
router.get("/areas", async (req, res) => {
    try {
        const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;

        const wardRows = await pool.query(`
            SELECT DISTINCT ward FROM collection_points WHERE ward IS NOT NULL ORDER BY ward ASC
        `);

        const pointsRes = await pool.query(`
            SELECT id, name, address, ward, latitude, longitude, scheduled_time
            FROM collection_points
            ORDER BY ward ASC, id ASC
        `);

        const permRes = await pool.query(`
            SELECT vaa.ward, vaa.vehicle_id, v.vehicle_number, u.name AS driver_name
            FROM vehicle_area_assignments vaa
            JOIN vehicles v ON vaa.vehicle_id = v.id
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE
        `);

        const permByWard = {};
        for (const p of permRes.rows) {
            permByWard[p.ward] = p;
        }

        const pointsByWard = {};
        for (const pt of pointsRes.rows) {
            if (!pointsByWard[pt.ward]) pointsByWard[pt.ward] = [];
            pointsByWard[pt.ward].push(pt);
        }

        const areas = wardRows.rows.map(r => {
            const wardName = r.ward;
            const assigned = permByWard[wardName] || null;
            const isAssigned = Boolean(assigned);
            const isAssignedToCurrent = vehicleId && assigned ? assigned.vehicle_id === vehicleId : false;
            const isAssignedToOther = assigned ? (!vehicleId || assigned.vehicle_id !== vehicleId) : false;
            const isAvailable = !isAssigned || isAssignedToCurrent;

            return {
                ward: wardName,
                name: wardName,
                collection_points: pointsByWard[wardName] || [],
                total_points: (pointsByWard[wardName] || []).length,
                assigned_vehicle_id: assigned ? assigned.vehicle_id : null,
                assigned_vehicle_number: assigned ? assigned.vehicle_number : null,
                assigned_driver_name: assigned ? assigned.driver_name : null,
                is_assigned: isAssigned,
                is_assigned_to_current: isAssignedToCurrent,
                is_assigned_to_other: isAssignedToOther,
                is_available: isAvailable
            };
        });

        res.json(areas);
    } catch (error) {
        console.error("Fetch areas error:", error);
        res.status(500).json({ message: "Failed to fetch areas" });
    }
});

// GET /api/admin/available-areas - Returns available areas filtered for a specific vehicle
router.get("/available-areas", async (req, res) => {
    try {
        const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;

        const wardRows = await pool.query(`
            SELECT DISTINCT ward FROM collection_points WHERE ward IS NOT NULL ORDER BY ward ASC
        `);

        const pointsRes = await pool.query(`
            SELECT id, name, address, ward, latitude, longitude, scheduled_time
            FROM collection_points
            ORDER BY ward ASC, id ASC
        `);

        const permRes = await pool.query(`
            SELECT vaa.ward, vaa.vehicle_id, v.vehicle_number, u.name AS driver_name
            FROM vehicle_area_assignments vaa
            JOIN vehicles v ON vaa.vehicle_id = v.id
            LEFT JOIN users u ON v.driver_id = u.id
            WHERE vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE
        `);

        const permByWard = {};
        for (const p of permRes.rows) {
            permByWard[p.ward] = p;
        }

        const pointsByWard = {};
        for (const pt of pointsRes.rows) {
            if (!pointsByWard[pt.ward]) pointsByWard[pt.ward] = [];
            pointsByWard[pt.ward].push(pt);
        }

        const allAreas = wardRows.rows.map(r => {
            const wardName = r.ward;
            const assigned = permByWard[wardName] || null;
            const isAssigned = Boolean(assigned);
            const isAssignedToCurrent = vehicleId && assigned ? assigned.vehicle_id === vehicleId : false;
            const isAssignedToOther = assigned ? (!vehicleId || assigned.vehicle_id !== vehicleId) : false;
            const isAvailable = !isAssigned || isAssignedToCurrent;

            return {
                ward: wardName,
                name: wardName,
                collection_points: pointsByWard[wardName] || [],
                total_points: (pointsByWard[wardName] || []).length,
                assigned_vehicle_id: assigned ? assigned.vehicle_id : null,
                assigned_vehicle_number: assigned ? assigned.vehicle_number : null,
                assigned_driver_name: assigned ? assigned.driver_name : null,
                is_assigned: isAssigned,
                is_assigned_to_current: isAssignedToCurrent,
                is_assigned_to_other: isAssignedToOther,
                is_available: isAvailable
            };
        });

        const availableAreas = allAreas.filter(a => a.is_available);
        const unassignedAreas = allAreas.filter(a => !a.is_assigned);
        const assignedArea = allAreas.find(a => a.is_assigned_to_current) || null;
        const allAssigned = unassignedAreas.length === 0;

        res.json({
            vehicle_id: vehicleId,
            all_areas: allAreas,
            available_areas: availableAreas,
            unassigned_areas: unassignedAreas,
            assigned_area: assignedArea,
            all_assigned: allAssigned
        });
    } catch (error) {
        console.error("Fetch available areas error:", error);
        res.status(500).json({ message: "Failed to fetch available areas" });
    }
});

// POST /api/admin/set-permanent-area - Initial Setup or Update of Permanent Vehicle-to-Area Assignment
router.post("/set-permanent-area", async (req, res) => {
    try {
        const vehicle_id = req.body.vehicle_id || req.body.vehicleId || req.body.vehicle;
        let ward = req.body.ward || req.body.area || req.body.area_name || req.body.area_id;

        if (!vehicle_id || !ward) {
            return res.status(400).json({ message: "Vehicle and Area/Ward are required." });
        }

        // If ward is an ID, resolve to ward name
        if (!isNaN(Number(ward)) && !ward.toString().startsWith("Ward")) {
            const pointRes = await pool.query(`SELECT ward FROM collection_points WHERE id = $1`, [Number(ward)]);
            if (pointRes.rows.length > 0) {
                ward = pointRes.rows[0].ward;
            }
        }

        const vehRes = await pool.query(`SELECT id, vehicle_number, status FROM vehicles WHERE id = $1`, [Number(vehicle_id)]);
        if (vehRes.rows.length === 0) {
            return res.status(404).json({ message: "Vehicle not found." });
        }
        const vehicle = vehRes.rows[0];

        // Conflict check: Check if this ward is already permanently assigned to ANOTHER vehicle
        const conflictRes = await pool.query(
            `SELECT vaa.id, vaa.vehicle_id, v.vehicle_number, u.name AS driver_name
             FROM vehicle_area_assignments vaa
             JOIN vehicles v ON vaa.vehicle_id = v.id
             LEFT JOIN users u ON v.driver_id = u.id
             WHERE vaa.ward = $1 
               AND vaa.vehicle_id != $2 
               AND vaa.assignment_type = 'PERMANENT' 
               AND vaa.is_active = TRUE`,
            [ward, Number(vehicle_id)]
        );

        if (conflictRes.rows.length > 0) {
            const conflictVeh = conflictRes.rows[0];
            return res.status(409).json({
                message: `${ward} is already permanently assigned to ${conflictVeh.vehicle_number}${conflictVeh.driver_name ? ` (${conflictVeh.driver_name})` : ""}.`,
                conflict: {
                    ward,
                    vehicle_id: conflictVeh.vehicle_id,
                    vehicle_number: conflictVeh.vehicle_number,
                    driver_name: conflictVeh.driver_name
                }
            });
        }

        // 1. Deactivate existing permanent assignment for this vehicle
        await pool.query(
            `UPDATE vehicle_area_assignments 
             SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
             WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT'`,
            [Number(vehicle_id)]
        );

        // 2. Insert new permanent assignment
        const insertRes = await pool.query(
            `INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active)
             VALUES ($1, $2, 'PERMANENT', CURRENT_DATE, TRUE)
             RETURNING *`,
            [Number(vehicle_id), ward]
        );

        // 4. Activity Log
        await pool.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id)
             VALUES ($1, $2, $3)`,
            [
                'PERMANENT_AREA_ASSIGNED',
                `Authority permanently assigned Vehicle ${vehicle.vehicle_number} to ${ward}.`,
                Number(vehicle_id)
            ]
        );

        // 5. Sync daily operations
        await syncDailyRoutesForDate(new Date().toISOString().split("T")[0], pool);

        res.json({
            message: `${vehicle.vehicle_number} is now permanently assigned to ${ward}.`,
            assignment: insertRes.rows[0],
            vehicle_number: vehicle.vehicle_number,
            ward: ward
        });
    } catch (error) {
        console.error("Set permanent area error:", error);
        res.status(500).json({ message: error.message || "Failed to save permanent assignment", error: error.message });
    }
});

// GET /api/admin/notifications - Get all notifications for Authority
router.get("/notifications", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM notifications
            WHERE recipient_role IN ('AUTHORITY', 'ALL')
            ORDER BY id DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        console.error("Fetch notifications error:", error);
        res.status(500).json({ message: "Failed to fetch notifications" });
    }
});

// PUT /api/admin/notifications/:id/read - Mark notification as read
router.put("/notifications/:id/read", async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query(`UPDATE notifications SET is_read = TRUE WHERE id = $1`, [id]);
        res.json({ message: "Notification marked as read" });
    } catch (error) {
        console.error("Update notification error:", error);
        res.status(500).json({ message: "Failed to update notification" });
    }
});

// Reports & Analytics endpoint (Preserved)
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
        const estimatedWasteTons = (completedCollections * 0.5).toFixed(1);

        // 2. Collection Trend
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

// GET /api/admin/available-collection-points (Preserved for compatibility)
router.get("/available-collection-points", async (req, res) => {
    try {
        const { date, vehicle_id, ward } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];
        const currentVehId = vehicle_id ? Number(vehicle_id) : null;

        await syncDailyRoutesForDate(dateStr);

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

// POST /api/admin/assign-collection-points (Preserved for compatibility)
router.post("/assign-collection-points", async (req, res) => {
    const client = await pool.connect();
    try {
        const { vehicle_id, collection_point_ids, route_date } = req.body;

        if (!vehicle_id || !Array.isArray(collection_point_ids)) {
            return res.status(400).json({ message: "vehicle_id and collection_point_ids array are required" });
        }

        const uniqueCpIds = [...new Set(collection_point_ids.map(Number))].filter(id => !isNaN(id) && id > 0);

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

        const dateStr = route_date || new Date().toISOString().split("T")[0];

        await client.query("BEGIN");

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
            estimated_time_mins: optResult.estimatedTotalMinutes
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rbErr) {}
        console.error("Admin assign collection points error:", error);
        res.status(500).json({ message: "Failed to assign collection points", error: error.message });
    } finally {
        client.release();
    }
});

// GET /api/admin/vehicle-assignments (Preserved for compatibility)
router.get("/vehicle-assignments", async (req, res) => {
    try {
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        await syncDailyRoutesForDate(dateStr);

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
                (
                    SELECT vaa.ward 
                    FROM vehicle_area_assignments vaa 
                    WHERE vaa.vehicle_id = v.id 
                      AND vaa.assignment_type = 'PERMANENT' 
                      AND vaa.is_active = TRUE 
                    LIMIT 1
                ) AS permanent_ward,
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

// POST /api/admin/reassign-collection-points (Preserved for compatibility)
router.post("/reassign-collection-points", async (req, res) => {
    const client = await pool.connect();
    try {
        const { source_vehicle_id, destination_vehicle_id, collection_point_ids, route_date } = req.body;

        if (!source_vehicle_id || !destination_vehicle_id) {
            return res.status(400).json({ message: "source_vehicle_id and destination_vehicle_id are required." });
        }

        const dateStr = route_date || new Date().toISOString().split("T")[0];
        const uniqueCpIds = [...new Set(collection_point_ids.map(Number))].filter(id => !isNaN(id) && id > 0);

        await client.query("BEGIN");

        const srcRouteRes = await client.query(`SELECT id FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`, [source_vehicle_id, dateStr]);
        if (srcRouteRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "No active route found for source vehicle." });
        }
        const srcRouteId = srcRouteRes.rows[0].id;

        let destRouteRes = await client.query(`SELECT id FROM routes WHERE vehicle_id = $1 AND route_date = $2::date`, [destination_vehicle_id, dateStr]);
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

        for (const cpId of uniqueCpIds) {
            await client.query(
                `UPDATE route_stops SET route_id = $1 WHERE route_id = $2 AND collection_point_id = $3`,
                [destRouteId, srcRouteId, cpId]
            );
        }

        await client.query("COMMIT");

        await optimizeAndSaveRoute(srcRouteId, pool);
        await optimizeAndSaveRoute(destRouteId, pool);

        res.json({ message: "Collection points reassigned successfully." });
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rbErr) {}
        console.error("Reassign collection points error:", error);
        res.status(500).json({ message: "Failed to reassign collection points" });
    } finally {
        client.release();
    }
});

// GET /api/admin/collection-verification - Detailed live collection verification status for all zones
router.get("/collection-verification", async (req, res) => {
    try {
        const { date, ward } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        await syncDailyRoutesForDate(dateStr);

        let query = `
            SELECT 
                cp.id AS zone_id,
                cp.name AS zone_name,
                cp.address,
                cp.ward,
                cp.latitude AS zone_latitude,
                cp.longitude AS zone_longitude,
                COALESCE(cp.minimum_collection_time_seconds, 30) AS minimum_collection_time_seconds,
                COALESCE(cp.total_scanners, 3) AS total_scanners,
                COALESCE(cp.geofence_radius_meters, 100) AS geofence_radius_meters,
                rs.id AS route_stop_id,
                rs.sequence,
                rs.status AS stop_status,
                rs.actual_arrival,
                rs.actual_departure,
                rs.dwell_start_time,
                rs.verification_status,
                r.id AS route_id,
                r.vehicle_id,
                v.vehicle_number,
                v.status AS vehicle_status,
                v.current_latitude,
                v.current_longitude,
                u.id AS driver_id,
                u.name AS driver_name,
                u.phone AS driver_phone
            FROM collection_points cp
            LEFT JOIN (
                SELECT rs_sub.*
                FROM route_stops rs_sub
                JOIN routes r_sub ON rs_sub.route_id = r_sub.id
                WHERE r_sub.route_date = $1::date
            ) rs ON cp.id = rs.collection_point_id
            LEFT JOIN routes r ON rs.route_id = r.id
            LEFT JOIN vehicles v ON r.vehicle_id = v.id
            LEFT JOIN users u ON v.driver_id = u.id
        `;
        const params = [dateStr];

        if (ward) {
            query += ` WHERE cp.ward = $2`;
            params.push(ward);
        }

        query += ` ORDER BY cp.ward ASC, cp.id ASC`;

        const zonesRes = await pool.query(query, params);
        const zones = [];

        for (const z of zonesRes.rows) {
            const cpCheckpointsRes = await pool.query(
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
                [z.route_stop_id || 0, z.zone_id]
            );

            const checkpoints = cpCheckpointsRes.rows;
            const totalScanners = checkpoints.length || z.total_scanners || 3;
            const scannedCount = checkpoints.filter(c => c.is_scanned).length;

            const minSec = Number(z.minimum_collection_time_seconds) || 30;
            let elapsedDwellSec = 0;
            if (z.stop_status === "COMPLETED") {
                elapsedDwellSec = minSec;
            } else if (z.dwell_start_time) {
                elapsedDwellSec = Math.max(0, Math.floor((Date.now() - new Date(z.dwell_start_time).getTime()) / 1000));
            }

            const formatSec = (s) => {
                const mins = Math.floor(s / 60);
                const secs = s % 60;
                return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            };
            const dwellFormatted = `${formatSec(elapsedDwellSec)} / ${formatSec(minSec)}`;

            let distanceMeters = null;
            if (z.current_latitude && z.current_longitude && z.zone_latitude && z.zone_longitude) {
                const { calculateHaversineDistance } = require("../services/trafficService");
                const distKm = calculateHaversineDistance(
                    Number(z.current_latitude),
                    Number(z.current_longitude),
                    Number(z.zone_latitude),
                    Number(z.zone_longitude)
                );
                distanceMeters = Math.round(distKm * 1000);
            }

            const isInsideGeofence = distanceMeters !== null && distanceMeters <= (z.geofence_radius_meters || 100);

            let derivedStatus = "NOT_STARTED";
            if (z.stop_status === "COMPLETED") {
                derivedStatus = "COMPLETED";
            } else if (z.stop_status === "MISSED") {
                derivedStatus = "MISSED";
            } else if (z.verification_status === "DWELL_RESET") {
                derivedStatus = "DWELL_RESET";
            } else if (scannedCount >= totalScanners && elapsedDwellSec >= minSec) {
                derivedStatus = "READY_FOR_COMPLETION";
            } else if (z.dwell_start_time || scannedCount > 0 || z.stop_status === "IN_PROGRESS") {
                derivedStatus = "IN_PROGRESS";
            }

            const lastScan = checkpoints.filter(c => c.scanned_at).sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at))[0]?.scanned_at || null;

            zones.push({
                ...z,
                total_scanners: totalScanners,
                scanned_count: scannedCount,
                scanner_progress: `${scannedCount}/${totalScanners}`,
                elapsed_dwell_seconds: elapsedDwellSec,
                minimum_collection_time_seconds: minSec,
                dwell_formatted: dwellFormatted,
                distance_meters: distanceMeters,
                is_inside_geofence: isInsideGeofence,
                zone_status: derivedStatus,
                last_scan_time: lastScan,
                checkpoints: checkpoints
            });
        }

        res.json({
            date: dateStr,
            total_zones: zones.length,
            completed_zones: zones.filter(z => z.zone_status === 'COMPLETED').length,
            in_progress_zones: zones.filter(z => z.zone_status === 'IN_PROGRESS' || z.zone_status === 'READY_FOR_COMPLETION').length,
            not_started_zones: zones.filter(z => z.zone_status === 'NOT_STARTED').length,
            zones: zones
        });

    } catch (error) {
        console.error("Collection verification error:", error);
        res.status(500).json({ message: "Failed to fetch collection verification details." });
    }
});

// PATCH /api/admin/config/collection-time - Dynamically configure collection dwell time (e.g. for demo)
router.patch("/config/collection-time", async (req, res) => {
    try {
        const { seconds, ward, collection_point_id } = req.body;
        const minSec = parseInt(seconds, 10);
        if (isNaN(minSec) || minSec <= 0) {
            return res.status(400).json({ message: "Valid seconds integer (> 0) required." });
        }

        if (collection_point_id) {
            await pool.query(`UPDATE collection_points SET minimum_collection_time_seconds = $1 WHERE id = $2`, [minSec, collection_point_id]);
        } else if (ward) {
            await pool.query(`UPDATE collection_points SET minimum_collection_time_seconds = $1 WHERE ward = $2`, [minSec, ward]);
        } else {
            await pool.query(`UPDATE collection_points SET minimum_collection_time_seconds = $1`, [minSec]);
        }

        res.json({
            message: `Minimum collection dwell time updated to ${minSec} seconds.`,
            minimum_collection_time_seconds: minSec
        });
    } catch (error) {
        console.error("Config update error:", error);
        res.status(500).json({ message: "Failed to update configuration." });
    }
});

module.exports = router;