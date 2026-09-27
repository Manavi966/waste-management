require("dotenv").config();
const pool = require("./src/config/db");
const express = require("express");
const adminRoutes = require("./src/routes/adminRoutes");
const vehicleRoutes = require("./src/routes/vehicleRoutes");

async function testEndpoints() {
    try {
        const dateStr = "2026-09-20";
        console.log("=== Testing GET /admin/ward-overview logic ===");

        const wardRows = await pool.query(`
            SELECT DISTINCT ward FROM collection_points WHERE ward IS NOT NULL ORDER BY ward ASC
        `);
        console.log("wardRows count:", wardRows.rows.length);

        const pointsRes = await pool.query(`
            SELECT id, name, address, ward, latitude, longitude, scheduled_time
            FROM collection_points
            ORDER BY id ASC
        `);
        console.log("points count:", pointsRes.rows.length);

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
        console.log("permRes count:", permRes.rows.length);

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
        console.log("allVehicles count:", allVehiclesRes.rows);

        // Also check GET /api/vehicles
        const vehiclesRouteRes = await pool.query(`
            SELECT 
                v.id,
                v.vehicle_number,
                v.status,
                v.capacity,
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
                ) AS permanent_ward
            FROM vehicles v
            LEFT JOIN users u ON v.driver_id = u.id
            ORDER BY v.id ASC
        `);
        console.log("\nVehicles Route query count:", vehiclesRouteRes.rows);

    } catch (e) {
        console.error("Error testing endpoints:", e);
    } finally {
        process.exit(0);
    }
}

testEndpoints();
