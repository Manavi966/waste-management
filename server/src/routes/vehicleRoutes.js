const express = require("express");
const pool = require("../config/db");
const { syncDailyRoutesForDate, getEffectiveAssignmentForWard } = require("../services/dailyOperationService");
const { handleVehicleMaintenanceEvent, handleVehicleReturnedToServiceEvent } = require("../services/notificationService");

const router = express.Router();

// Get all vehicles with driver details, permanent area, temporary assignment, and status
router.get("/", async (req, res) => {
    try {
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        // Ensure daily routes are synchronized
        await syncDailyRoutesForDate(dateStr);

        const result = await pool.query(
            `SELECT 
                v.id,
                v.vehicle_number,
                v.driver_id,
                u.name AS driver_name,
                u.phone AS driver_phone,
                v.status,
                v.current_latitude,
                v.current_longitude,
                -- Permanent Area Assignment
                (
                    SELECT vaa.ward 
                    FROM vehicle_area_assignments vaa 
                    WHERE vaa.vehicle_id = v.id 
                      AND vaa.assignment_type = 'PERMANENT' 
                      AND vaa.is_active = TRUE 
                    LIMIT 1
                ) AS permanent_ward,
                -- Temporary Area Assignment (if this vehicle is currently covering another ward)
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
                -- Replaced Vehicle (if this vehicle is covering for someone)
                (
                    SELECT v_rep.vehicle_number 
                    FROM vehicle_area_assignments vaa 
                    JOIN vehicles v_rep ON vaa.replaced_vehicle_id = v_rep.id
                    WHERE vaa.vehicle_id = v.id 
                      AND vaa.assignment_type = 'TEMPORARY' 
                      AND vaa.is_active = TRUE 
                      AND vaa.start_date <= $1::date 
                      AND (vaa.end_date IS NULL OR vaa.end_date >= $1::date)
                    ORDER BY vaa.id DESC 
                    LIMIT 1
                ) AS covering_for_vehicle,
                -- Replacement Vehicle (if THIS vehicle is under maintenance and has a replacement)
                (
                    SELECT v_rep.vehicle_number 
                    FROM vehicle_area_assignments vaa 
                    JOIN vehicles v_rep ON vaa.vehicle_id = v_rep.id
                    WHERE vaa.replaced_vehicle_id = v.id 
                      AND vaa.assignment_type = 'TEMPORARY' 
                      AND vaa.is_active = TRUE 
                      AND vaa.start_date <= $1::date 
                      AND (vaa.end_date IS NULL OR vaa.end_date >= $1::date)
                    ORDER BY vaa.id DESC 
                    LIMIT 1
                ) AS replacement_vehicle_number,
                COALESCE(
                    (SELECT COUNT(rs.id) 
                     FROM route_stops rs 
                     JOIN routes r ON rs.route_id = r.id 
                     WHERE r.vehicle_id = v.id AND r.route_date = $1::date),
                    0
                ) AS assigned_stops,
                COALESCE(
                    (SELECT COUNT(rs.id) 
                     FROM route_stops rs 
                     JOIN routes r ON rs.route_id = r.id 
                     WHERE r.vehicle_id = v.id AND r.route_date = $1::date AND rs.status = 'COMPLETED'),
                    0
                ) AS completed_stops
             FROM vehicles v
             LEFT JOIN users u ON v.driver_id = u.id
             ORDER BY v.id ASC`,
            [dateStr]
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Vehicles fetch error:", error);
        res.status(500).json({ message: "Failed to fetch vehicles" });
    }
});

// Get all vehicle area assignments (Permanent & Temporary)
router.get("/assignments", async (req, res) => {
    try {
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        const result = await pool.query(`
            SELECT 
                vaa.id,
                vaa.vehicle_id,
                v.vehicle_number,
                v.status AS vehicle_status,
                u.name AS driver_name,
                vaa.ward,
                vaa.assignment_type,
                vaa.start_date,
                vaa.end_date,
                vaa.is_active,
                vaa.replaced_vehicle_id,
                v_rep.vehicle_number AS replaced_vehicle_number,
                (SELECT COUNT(id) FROM collection_points WHERE ward = vaa.ward) AS total_collection_points
            FROM vehicle_area_assignments vaa
            JOIN vehicles v ON vaa.vehicle_id = v.id
            LEFT JOIN users u ON v.driver_id = u.id
            LEFT JOIN vehicles v_rep ON vaa.replaced_vehicle_id = v_rep.id
            WHERE vaa.is_active = TRUE
            ORDER BY vaa.assignment_type DESC, vaa.id ASC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error("Fetch vehicle assignments error:", error);
        res.status(500).json({ message: "Failed to fetch vehicle area assignments" });
    }
});

// Get detailed vehicle info including permanent area, permanent collection points, today's route, replacement info
router.get("/:id/details", async (req, res) => {
    try {
        const { id } = req.params;
        const { date } = req.query;
        const dateStr = date || new Date().toISOString().split("T")[0];

        // Ensure routes are synced
        await syncDailyRoutesForDate(dateStr);

        const vehicleRes = await pool.query(
            `SELECT 
                v.id AS vehicle_id,
                v.id,
                v.vehicle_number,
                v.status AS vehicle_status,
                v.status,
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
             LEFT JOIN routes r ON r.vehicle_id = v.id AND r.route_date = $2::date
             WHERE v.id = $1`,
            [id, dateStr]
        );

        if (vehicleRes.rows.length === 0) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const vehicleInfo = vehicleRes.rows[0];

        // 1. Fetch Permanent Area Assignment
        const permAssignRes = await pool.query(`
            SELECT id, ward, assignment_type, start_date, is_active
            FROM vehicle_area_assignments
            WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT' AND is_active = TRUE
            LIMIT 1
        `, [id]);

        const permanentAssignment = permAssignRes.rows[0] || null;
        const permanentWard = permanentAssignment?.ward || null;

        // 2. Fetch Permanent Collection Points for this ward
        let permanentPoints = [];
        if (permanentWard) {
            const cpRes = await pool.query(`
                SELECT id, name, address, ward, latitude, longitude, scheduled_time
                FROM collection_points
                WHERE ward = $1
                ORDER BY id ASC
            `, [permanentWard]);
            permanentPoints = cpRes.rows;
        }

        // 3. Fetch Temporary Replacement Assignment if applicable
        // Case A: This vehicle is COVERING for another vehicle temporarily
        const coveringRes = await pool.query(`
            SELECT 
                vaa.id, vaa.ward, vaa.start_date, vaa.end_date, vaa.replaced_vehicle_id,
                v_orig.vehicle_number AS original_vehicle_number
            FROM vehicle_area_assignments vaa
            JOIN vehicles v_orig ON vaa.replaced_vehicle_id = v_orig.id
            WHERE vaa.vehicle_id = $1 
              AND vaa.assignment_type = 'TEMPORARY' 
              AND vaa.is_active = TRUE 
              AND vaa.start_date <= $2::date 
              AND (vaa.end_date IS NULL OR vaa.end_date >= $2::date)
            LIMIT 1
        `, [id, dateStr]);

        const coveringAssignment = coveringRes.rows[0] || null;

        // Case B: This vehicle is in MAINTENANCE and has a replacement vehicle covering its ward
        const replacedByRes = await pool.query(`
            SELECT 
                vaa.id, vaa.ward, vaa.start_date, vaa.end_date, vaa.vehicle_id AS replacement_vehicle_id,
                v_rep.vehicle_number AS replacement_vehicle_number,
                u_rep.name AS replacement_driver_name,
                u_rep.phone AS replacement_driver_phone
            FROM vehicle_area_assignments vaa
            JOIN vehicles v_rep ON vaa.vehicle_id = v_rep.id
            LEFT JOIN users u_rep ON v_rep.driver_id = u_rep.id
            WHERE vaa.replaced_vehicle_id = $1 
              AND vaa.assignment_type = 'TEMPORARY' 
              AND vaa.is_active = TRUE 
              AND vaa.start_date <= $2::date 
              AND (vaa.end_date IS NULL OR vaa.end_date >= $2::date)
            LIMIT 1
        `, [id, dateStr]);

        const replacementCoverage = replacedByRes.rows[0] || null;

        // 4. Fetch Route Stops for today
        let stops = [];
        if (vehicleInfo.route_id) {
            const stopsRes = await pool.query(
                `SELECT 
                    rs.id AS stop_id,
                    rs.id AS route_stop_id,
                    rs.sequence,
                    rs.status AS stop_status,
                    rs.status,
                    rs.expected_arrival,
                    rs.actual_arrival,
                    rs.actual_departure,
                    rs.miss_reason,
                    cp.id AS collection_point_id,
                    cp.name AS point_name,
                    cp.name,
                    cp.address,
                    cp.ward,
                    cp.latitude,
                    cp.longitude,
                    cp.scheduled_time
                 FROM route_stops rs
                 JOIN collection_points cp ON rs.collection_point_id = cp.id
                 WHERE rs.route_id = $1
                 ORDER BY rs.sequence ASC`,
                [vehicleInfo.route_id]
            );
            stops = stopsRes.rows;
        }

        const completedStops = stops.filter(s => s.stop_status === 'COMPLETED' || s.status === 'COMPLETED');
        const pendingStops = stops.filter(s => s.stop_status === 'PENDING' || s.status === 'PENDING');
        const missedStops = stops.filter(s => s.stop_status === 'MISSED' || s.status === 'MISSED');

        const isMaintenance = (vehicleInfo.vehicle_status || "").toUpperCase() === "MAINTENANCE";

        let todayCollectionStatus = "ON_SCHEDULE";
        if (isMaintenance) {
            todayCollectionStatus = replacementCoverage ? "COVERED_BY_REPLACEMENT" : "NOT_AVAILABLE";
        } else if (stops.length === 0) {
            todayCollectionStatus = "NO_STOPS_SCHEDULED";
        } else if (completedStops.length === stops.length && stops.length > 0) {
            todayCollectionStatus = "COMPLETED";
        } else if (missedStops.length > 0) {
            todayCollectionStatus = "HAS_MISSED_STOPS";
        }

        res.json({
            vehicle: {
                ...vehicleInfo,
                permanent_ward: permanentWard,
                is_maintenance: isMaintenance
            },
            permanent_assignment: permanentAssignment,
            permanent_ward: permanentWard,
            permanent_collection_points: permanentPoints,
            temporary_assignment: coveringAssignment,
            is_covering: coveringAssignment !== null,
            covering_for: coveringAssignment,
            replacement_coverage: replacementCoverage,
            today_status: todayCollectionStatus,
            summary: {
                total_stops: stops.length,
                completed_count: completedStops.length,
                pending_count: pendingStops.length,
                missed_count: missedStops.length
            },
            completed_areas: completedStops,
            pending_areas: pendingStops,
            missed_areas: missedStops,
            all_stops: stops
        });
    } catch (error) {
        console.error("Fetch vehicle details error:", error);
        res.status(500).json({ message: "Failed to fetch vehicle details" });
    }
});

// Add a new vehicle (Authority) + Optional permanent area assignment
router.post("/", async (req, res) => {
    try {
        const { vehicle_number, driver_id, status, ward } = req.body;

        if (!vehicle_number) {
            return res.status(400).json({ message: "Vehicle number is required" });
        }

        // If ward is provided, check conflict first
        if (ward) {
            const conflictCheck = await pool.query(
                `SELECT vaa.id, vaa.vehicle_id, v.vehicle_number 
                 FROM vehicle_area_assignments vaa 
                 JOIN vehicles v ON vaa.vehicle_id = v.id
                 WHERE vaa.ward = $1 AND vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE`,
                [ward]
            );
            if (conflictCheck.rows.length > 0) {
                return res.status(409).json({
                    message: `${ward} is already permanently assigned to vehicle ${conflictCheck.rows[0].vehicle_number}. Cannot assign to another vehicle.`
                });
            }
        }

        const result = await pool.query(
            `INSERT INTO vehicles (vehicle_number, driver_id, status, current_latitude, current_longitude)
             VALUES ($1, $2, $3, 12.9716, 77.5946)
             RETURNING *`,
            [vehicle_number, driver_id || null, status || 'AVAILABLE']
        );

        const newVehicle = result.rows[0];

        // If ward is provided, set permanent area assignment
        if (ward) {
            await pool.query(
                `INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active)
                 VALUES ($1, $2, 'PERMANENT', CURRENT_DATE, TRUE)`,
                [newVehicle.id, ward]
            );
        }

        res.status(201).json({
            message: "Vehicle created successfully",
            vehicle: newVehicle
        });
    } catch (error) {
        console.error("Add vehicle error:", error);
        res.status(500).json({ message: "Failed to create vehicle" });
    }
});

// Update vehicle driver / status / permanent area
router.put("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { driver_id, status, ward } = req.body;

        const currentRes = await pool.query(`SELECT * FROM vehicles WHERE id = $1`, [id]);
        if (currentRes.rows.length === 0) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const oldVehicle = currentRes.rows[0];
        const oldStatus = (oldVehicle.status || "").toUpperCase();
        const newStatus = status ? status.toUpperCase() : oldStatus;

        // Look up permanent area for this vehicle
        const permRes = await pool.query(
            `SELECT ward FROM vehicle_area_assignments WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT' AND is_active = TRUE LIMIT 1`,
            [id]
        );
        const vehicleWard = permRes.rows[0]?.ward || null;

        // If ward is explicitly provided and changing, check for conflicts with other vehicles
        if (ward && ward !== vehicleWard) {
            const conflictRes = await pool.query(
                `SELECT vaa.id, vaa.vehicle_id, v.vehicle_number, u.name AS driver_name
                 FROM vehicle_area_assignments vaa
                 JOIN vehicles v ON vaa.vehicle_id = v.id
                 LEFT JOIN users u ON v.driver_id = u.id
                 WHERE vaa.ward = $1 
                   AND vaa.vehicle_id != $2 
                   AND vaa.assignment_type = 'PERMANENT' 
                   AND vaa.is_active = TRUE`,
                [ward, id]
            );

            if (conflictRes.rows.length > 0) {
                const conflictVeh = conflictRes.rows[0];
                return res.status(409).json({
                    message: `${ward} is already permanently assigned to ${conflictVeh.vehicle_number}${conflictVeh.driver_name ? ` (${conflictVeh.driver_name})` : ""}.`
                });
            }
        }

        // Update vehicle record
        const result = await pool.query(
            `UPDATE vehicles
             SET driver_id = COALESCE($1, driver_id),
                 status = COALESCE($2, status)
             WHERE id = $3
             RETURNING *`,
            [driver_id !== undefined ? driver_id : null, status || null, id]
        );

        const vehicle = result.rows[0];

        let requiresReassignment = false;

        // Handle transition TO MAINTENANCE
        if (newStatus === "MAINTENANCE" && oldStatus !== "MAINTENANCE") {
            requiresReassignment = true;
            await handleVehicleMaintenanceEvent(vehicle.id, vehicle.vehicle_number, vehicleWard, pool);
        }
        // Handle transition FROM MAINTENANCE back to IN_SERVICE / AVAILABLE / ACTIVE
        else if (oldStatus === "MAINTENANCE" && newStatus !== "MAINTENANCE") {
            // End any active temporary replacement assignment covering this ward
            if (vehicleWard) {
                await pool.query(
                    `UPDATE vehicle_area_assignments
                     SET is_active = FALSE, end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP
                     WHERE ward = $1 AND assignment_type = 'TEMPORARY' AND is_active = TRUE`,
                    [vehicleWard]
                );
            }
            await handleVehicleReturnedToServiceEvent(vehicle.id, vehicle.vehicle_number, vehicleWard, pool);
        } else if (status) {
            await pool.query(
                `INSERT INTO activity_logs (event_type, description, vehicle_id)
                 VALUES ($1, $2, $3)`,
                ['VEHICLE_STATUS_UPDATED', `Vehicle ${vehicle.vehicle_number} status updated to ${status}`, id]
            );
        }

        // If ward is explicitly provided and changing, update permanent area
        if (ward && ward !== vehicleWard) {
            // Deactivate previous permanent assignment for THIS vehicle
            await pool.query(
                `UPDATE vehicle_area_assignments 
                 SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
                 WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT'`,
                [id]
            );
            // Insert new permanent assignment
            await pool.query(
                `INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active)
                 VALUES ($1, $2, 'PERMANENT', CURRENT_DATE, TRUE)`,
                [id, ward]
            );
        }

        // Re-sync today's routes
        await syncDailyRoutesForDate(new Date().toISOString().split("T")[0]);

        res.json({
            message: requiresReassignment
                ? `Vehicle ${vehicle.vehicle_number} marked as MAINTENANCE. Citizen & Authority alerts dispatched. Replacement vehicle assignment required.`
                : "Vehicle updated successfully",
            vehicle,
            requires_reassignment: requiresReassignment,
            permanent_ward: ward || vehicleWard
        });
    } catch (error) {
        console.error("Update vehicle error:", error);
        res.status(500).json({ message: "Failed to update vehicle" });
    }
});

// Get Vehicle Permanent Area Assignment (Date-independent)
router.get("/:id/permanent-assignment", async (req, res) => {
    try {
        const { id } = req.params;
        const vehRes = await pool.query(
            `SELECT v.id, v.vehicle_number, v.status, v.driver_id, u.name AS driver_name, u.phone AS driver_phone
             FROM vehicles v
             LEFT JOIN users u ON v.driver_id = u.id
             WHERE v.id = $1`,
            [id]
        );
        if (vehRes.rows.length === 0) {
            return res.status(404).json({ message: "Vehicle not found" });
        }
        const vehicle = vehRes.rows[0];

        const assignRes = await pool.query(
            `SELECT vaa.id, vaa.ward, vaa.assignment_type, vaa.start_date, vaa.is_active, vaa.created_at, vaa.updated_at
             FROM vehicle_area_assignments vaa
             WHERE vaa.vehicle_id = $1 AND vaa.assignment_type = 'PERMANENT' AND vaa.is_active = TRUE
             LIMIT 1`,
            [id]
        );

        const assignment = assignRes.rows[0] || null;

        res.json({
            vehicle_id: vehicle.id,
            vehicle_number: vehicle.vehicle_number,
            status: vehicle.status,
            driver_name: vehicle.driver_name,
            permanent_ward: assignment?.ward || null,
            is_assigned: Boolean(assignment),
            assignment: assignment
        });
    } catch (error) {
        console.error("Get permanent assignment error:", error);
        res.status(500).json({ message: "Failed to get permanent assignment" });
    }
});

// Assign / Update Permanent Area for a Vehicle
router.post("/:id/permanent-area", async (req, res) => {
    try {
        const { id } = req.params;
        const { ward } = req.body;

        if (!ward) {
            return res.status(400).json({ message: "Ward/Area name is required" });
        }

        const vehRes = await pool.query(`SELECT id, vehicle_number FROM vehicles WHERE id = $1`, [id]);
        if (vehRes.rows.length === 0) {
            return res.status(404).json({ message: "Vehicle not found" });
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
            [ward, id]
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
            [id]
        );

        // 2. Insert new permanent assignment
        const insertRes = await pool.query(
            `INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active)
             VALUES ($1, $2, 'PERMANENT', CURRENT_DATE, TRUE)
             RETURNING *`,
            [id, ward]
        );

        // 3. Log to activity_logs
        await pool.query(
            `INSERT INTO activity_logs (event_type, description, vehicle_id)
             VALUES ($1, $2, $3)`,
            [
                'PERMANENT_AREA_ASSIGNED',
                `Vehicle ${vehicle.vehicle_number} permanently assigned to ${ward}.`,
                id
            ]
        );

        // 4. Sync daily routes for today
        await syncDailyRoutesForDate(new Date().toISOString().split("T")[0]);

        res.json({
            message: `Vehicle ${vehicle.vehicle_number} permanently assigned to ${ward} successfully.`,
            assignment: insertRes.rows[0]
        });
    } catch (error) {
        console.error("Assign permanent area error:", error);
        res.status(500).json({ message: "Failed to assign permanent area", error: error.message });
    }
});

// Get vehicle assigned to a driver (Preserved endpoint)
router.get("/driver/:driverId", async (req, res) => {
    try {
        const { driverId } = req.params;

        const result = await pool.query(
            `SELECT id, vehicle_number, status,
                    current_latitude, current_longitude
             FROM vehicles
             WHERE driver_id = $1`,
            [driverId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error("Vehicle fetch error:", error);
        res.status(500).json({ message: "Failed to fetch vehicle" });
    }
});

module.exports = router;