require("dotenv").config();
const pool = require("./db");

async function initDatabase() {
    try {
        console.log("🛠️ Initializing database tables and permanent vehicle-to-area schema...");

        // 1. Create vehicle_area_assignments table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vehicle_area_assignments (
                id SERIAL PRIMARY KEY,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                ward VARCHAR(100) NOT NULL,
                assignment_type VARCHAR(50) NOT NULL DEFAULT 'PERMANENT',
                start_date DATE DEFAULT CURRENT_DATE,
                end_date DATE,
                is_active BOOLEAN DEFAULT TRUE,
                replaced_vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Partial unique indexes for data integrity
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_active_permanent_vehicle 
            ON vehicle_area_assignments (vehicle_id) 
            WHERE (is_active = TRUE AND assignment_type = 'PERMANENT');
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_active_permanent_ward 
            ON vehicle_area_assignments (ward) 
            WHERE (is_active = TRUE AND assignment_type = 'PERMANENT');
        `);

        // 2. Create notifications table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                recipient_role VARCHAR(50) NOT NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                ward VARCHAR(100),
                title VARCHAR(255) NOT NULL,
                message TEXT NOT NULL,
                type VARCHAR(50) DEFAULT 'MAINTENANCE_ALERT',
                vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. Extend collection_points table with zone parameters
        await pool.query(`
            ALTER TABLE collection_points ADD COLUMN IF NOT EXISTS minimum_collection_time_seconds INTEGER DEFAULT 30;
            ALTER TABLE collection_points ADD COLUMN IF NOT EXISTS total_scanners INTEGER DEFAULT 3;
            ALTER TABLE collection_points ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ACTIVE';
            ALTER TABLE collection_points ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER DEFAULT 100;
        `);

        // 4. Ensure master unique constraints
        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_points_ward_name 
            ON collection_points (LOWER(TRIM(ward)), LOWER(TRIM(name)));
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_routes_vehicle_date 
            ON routes (vehicle_id, route_date);
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_route_stops_route_cp 
            ON route_stops (route_id, collection_point_id);
        `);

        // 5. Ensure collection points have consistent canonical wards (Ward 12, 13, 14, 15, 16)
        const wardMappings = [
            // Ward 12 (Central)
            { names: ["5th Cross", "5th Cross Road", "Main Market", "City Park", "Government School", "Apartment Complex"], ward: "Ward 12" },
            // Ward 13 (Jayanagar / Basavanagudi)
            { names: ["Jayanagar 4th Block", "Jayanagar Shopping Complex", "South End Circle", "Basavanagudi Market", "Lalbagh Gate"], ward: "Ward 13" },
            // Ward 14 (Malleshwaram / Rajajinagar)
            { names: ["Malleshwaram 8th Cross", "Mantri Mall", "Rajajinagar 1st Block", "Navrang Junction", "Orion Mall Area"], ward: "Ward 14" },
            // Ward 15 (Whitefield)
            { names: ["Whitefield Main Road", "ITPL Main Gate", "Hope Farm", "Kadugodi Park", "Whitefield Railway Station", "Whitefield IT Hub"], ward: "Ward 15" },
            // Ward 16 (Indiranagar / Brookefield)
            { names: ["Indiranagar 100ft Road", "Brookefield Market", "AECS Layout", "Kadugodi Tree Park", "Whitefield Bus Stand"], ward: "Ward 16" }
        ];

        for (const mapping of wardMappings) {
            await pool.query(`
                UPDATE collection_points
                SET ward = $1
                WHERE name = ANY($2::text[])
            `, [mapping.ward, mapping.names]);
        }

        // 6. Seed Default Permanent Vehicle-to-Area Assignments
        const defaultAssignments = [
            { vehicle_number: "KA01AB1234", ward: "Ward 12" },
            { vehicle_number: "KA02CD5678", ward: "Ward 13" },
            { vehicle_number: "KA03EF9012", ward: "Ward 14" },
            { vehicle_number: "KA04GH3456", ward: "Ward 15" },
            { vehicle_number: "KA05IJ7890", ward: "Ward 16" }
        ];

        for (const da of defaultAssignments) {
            const vehRes = await pool.query(`SELECT id FROM vehicles WHERE vehicle_number = $1`, [da.vehicle_number]);
            if (vehRes.rows.length > 0) {
                const vId = vehRes.rows[0].id;
                const existing = await pool.query(
                    `SELECT id FROM vehicle_area_assignments WHERE vehicle_id = $1 AND assignment_type = 'PERMANENT' AND is_active = TRUE`,
                    [vId]
                );
                if (existing.rows.length === 0) {
                    const wardTaken = await pool.query(
                        `SELECT id FROM vehicle_area_assignments WHERE ward = $1 AND assignment_type = 'PERMANENT' AND is_active = TRUE`,
                        [da.ward]
                    );
                    if (wardTaken.rows.length === 0) {
                        await pool.query(
                            `INSERT INTO vehicle_area_assignments (vehicle_id, ward, assignment_type, start_date, is_active)
                             VALUES ($1, $2, 'PERMANENT', CURRENT_DATE, TRUE)`,
                            [vId, da.ward]
                        );
                    }
                }
            }
        }

        // 7. Create scanner_checkpoints table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scanner_checkpoints (
                id SERIAL PRIMARY KEY,
                collection_point_id INTEGER NOT NULL REFERENCES collection_points(id) ON DELETE CASCADE,
                scanner_code VARCHAR(100) NOT NULL UNIQUE,
                name VARCHAR(150) NOT NULL,
                sequence INTEGER NOT NULL DEFAULT 1,
                latitude NUMERIC(10, 6),
                longitude NUMERIC(10, 6),
                status VARCHAR(50) DEFAULT 'ACTIVE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 8. Create scanner_scan_records table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS scanner_scan_records (
                id SERIAL PRIMARY KEY,
                scanner_id INTEGER NOT NULL REFERENCES scanner_checkpoints(id) ON DELETE CASCADE,
                collection_point_id INTEGER NOT NULL REFERENCES collection_points(id) ON DELETE CASCADE,
                vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                route_stop_id INTEGER REFERENCES route_stops(id) ON DELETE CASCADE,
                route_date DATE DEFAULT CURRENT_DATE,
                scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                gps_latitude NUMERIC(10, 6),
                gps_longitude NUMERIC(10, 6),
                distance_meters NUMERIC(10, 2),
                verification_status VARCHAR(50) DEFAULT 'VERIFIED',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_stop_scanner 
            ON scanner_scan_records (route_stop_id, scanner_id)
            WHERE (verification_status = 'VERIFIED' AND route_stop_id IS NOT NULL);
        `);

        // 9. Extend route_stops with dwell tracking & verification fields
        await pool.query(`
            ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS dwell_start_time TIMESTAMP;
            ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS last_gps_inside_at TIMESTAMP;
            ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS scanned_count INTEGER DEFAULT 0;
            ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'NOT_STARTED';
        `);

        // 10. Seed Scanner Checkpoints for all master collection zones
        const allPointsRes = await pool.query(`
            SELECT id, name, ward, latitude, longitude, minimum_collection_time_seconds
            FROM collection_points
            ORDER BY id ASC
        `);

        for (const pt of allPointsRes.rows) {
            const wardNum = (pt.ward || "W12").replace(/\D/g, "") || "12";
            const existingCheckpoints = await pool.query(
                `SELECT id FROM scanner_checkpoints WHERE collection_point_id = $1`,
                [pt.id]
            );

            if (existingCheckpoints.rows.length === 0) {
                const lat = Number(pt.latitude) || 12.9716;
                const lon = Number(pt.longitude) || 77.5946;

                // Create 3 representative checkpoints for each zone
                const checkpointData = [
                    {
                        code: `SCN-W${wardNum}-${pt.id}-1`,
                        name: `Scanner 1 (Entry / North Section)`,
                        seq: 1,
                        lat: Number((lat + 0.00015).toFixed(6)),
                        lon: Number((lon + 0.00010).toFixed(6))
                    },
                    {
                        code: `SCN-W${wardNum}-${pt.id}-2`,
                        name: `Scanner 2 (Central Junction)`,
                        seq: 2,
                        lat: Number(lat.toFixed(6)),
                        lon: Number(lon.toFixed(6))
                    },
                    {
                        code: `SCN-W${wardNum}-${pt.id}-3`,
                        name: `Scanner 3 (Exit / South Section)`,
                        seq: 3,
                        lat: Number((lat - 0.00015).toFixed(6)),
                        lon: Number((lon - 0.00010).toFixed(6))
                    }
                ];

                for (const cp of checkpointData) {
                    await pool.query(
                        `INSERT INTO scanner_checkpoints (collection_point_id, scanner_code, name, sequence, latitude, longitude, status)
                         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
                         ON CONFLICT (scanner_code) DO NOTHING`,
                        [pt.id, cp.code, cp.name, cp.seq, cp.lat, cp.lon]
                    );
                }

                await pool.query(
                    `UPDATE collection_points 
                     SET total_scanners = 3, minimum_collection_time_seconds = COALESCE(minimum_collection_time_seconds, 30)
                     WHERE id = $1`,
                    [pt.id]
                );
            }
        }

        console.log("✓ Database tables, scanner checkpoints, unique constraints, and permanent assignments initialized successfully.");
    } catch (err) {
        console.error("❌ initDatabase error:", err);
    }
}

module.exports = initDatabase;
