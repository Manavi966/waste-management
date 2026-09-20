require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("./config/db");

async function seedDatabase() {
    try {
        console.log("🌱 Starting CleanTrack Database Migration & Seeding...");

        // 1. Database Schema Alterations & Creation
        await pool.query(`
            ALTER TABLE complaints 
            ADD COLUMN IF NOT EXISTS assigned_vehicle_id INTEGER REFERENCES vehicles(id);
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id SERIAL PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                description TEXT NOT NULL,
                vehicle_id INTEGER REFERENCES vehicles(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Hash Password for Users
        const hashedPassword = await bcrypt.hash("password123", 10);

        // 3. Seed Users (Authority, Drivers, Citizens)
        const usersData = [
            { name: "System Admin", email: "authority@cleantrack.com", role: "AUTHORITY", phone: "9876543200" },
            { name: "Ramesh Kumar", email: "ramesh@cleantrack.com", role: "DRIVER", phone: "9876543201" },
            { name: "Suresh Patel", email: "suresh@cleantrack.com", role: "DRIVER", phone: "9876543202" },
            { name: "Ajay Singh", email: "ajay@cleantrack.com", role: "DRIVER", phone: "9876543203" },
            { name: "Vikram Rao", email: "vikram@cleantrack.com", role: "DRIVER", phone: "9876543204" },
            { name: "Pradeep Kumar", email: "pradeep@cleantrack.com", role: "DRIVER", phone: "9876543205" },
            { name: "Priya Sharma", email: "priya@gmail.com", role: "CITIZEN", phone: "9876543206" },
            { name: "Rohan Oza", email: "rohan@gmail.com", role: "CITIZEN", phone: "9876543207" }
        ];

        for (const u of usersData) {
            const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [u.email]);
            if (existing.rows.length === 0) {
                await pool.query(`
                    INSERT INTO users (name, email, password, phone, role)
                    VALUES ($1, $2, $3, $4, $5)
                `, [u.name, u.email, hashedPassword, u.phone, u.role]);
            }
        }

        // Fetch driver IDs
        const driversRes = await pool.query(`SELECT id, email FROM users WHERE role = 'DRIVER' ORDER BY id`);
        const driverMap = {};
        driversRes.rows.forEach(d => driverMap[d.email] = d.id);

        // 4. Seed Vehicles (5 vehicles in Bangalore areas)
        const vehiclesData = [
            { vehicle_number: "KA01AB1234", driver_id: driverMap["ramesh@cleantrack.com"], status: "IN_SERVICE", lat: 12.9716, lon: 77.5946 }, // Central
            { vehicle_number: "KA02CD5678", driver_id: driverMap["suresh@cleantrack.com"], status: "IN_SERVICE", lat: 12.9250, lon: 77.5938 }, // Jayanagar
            { vehicle_number: "KA03EF9012", driver_id: driverMap["ajay@cleantrack.com"], status: "ON_ROUTE", lat: 12.9988, lon: 77.5705 }, // Malleshwaram
            { vehicle_number: "KA04GH3456", driver_id: driverMap["vikram@cleantrack.com"], status: "IN_SERVICE", lat: 12.9698, lon: 77.7499 }, // Whitefield
            { vehicle_number: "KA05IJ7890", driver_id: driverMap["pradeep@cleantrack.com"], status: "MAINTENANCE", lat: 12.9784, lon: 77.6408 }  // Indiranagar
        ];

        for (const v of vehiclesData) {
            const existing = await pool.query(`SELECT id FROM vehicles WHERE vehicle_number = $1`, [v.vehicle_number]);
            if (existing.rows.length === 0) {
                await pool.query(`
                    INSERT INTO vehicles (vehicle_number, driver_id, status, current_latitude, current_longitude)
                    VALUES ($1, $2, $3, $4, $5);
                `, [v.vehicle_number, v.driver_id || null, v.status, v.lat, v.lon]);
            } else {
                await pool.query(`
                    UPDATE vehicles
                    SET driver_id = $1, status = $2, current_latitude = $3, current_longitude = $4
                    WHERE vehicle_number = $5;
                `, [v.driver_id || null, v.status, v.lat, v.lon, v.vehicle_number]);
            }
        }

        // Fetch vehicle IDs
        const vehiclesRes = await pool.query(`SELECT id, vehicle_number FROM vehicles ORDER BY id`);
        const vehicleMap = {};
        vehiclesRes.rows.forEach(v => vehicleMap[v.vehicle_number] = v.id);

        // 5. Seed Initial GPS Tracking entries for each vehicle
        for (const v of vehiclesData) {
            const vId = vehicleMap[v.vehicle_number];
            await pool.query(`
                INSERT INTO gps_tracking (vehicle_id, latitude, longitude, speed, recorded_at)
                VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP);
            `, [vId, v.lat, v.lon, v.status === "ON_ROUTE" ? 15 : 0]);
        }

        // 6. Seed Collection Points (25 Points across Bangalore Wards)
        const collectionPointsData = [
            // Central Bangalore (Ward 12)
            { name: "5th Cross Road", address: "5th Cross, MG Road", ward: "Ward 12", lat: 12.9716, lon: 77.5946, time: "09:00:00" },
            { name: "Main Market", address: "Commercial Street", ward: "Ward 12", lat: 12.9752, lon: 77.6012, time: "09:20:00" },
            { name: "City Park", address: "Cubbon Park Gate", ward: "Ward 12", lat: 12.9801, lon: 77.6105, time: "09:40:00" },
            { name: "Government School", address: "Residency Road", ward: "Ward 12", lat: 12.9845, lon: 77.6152, time: "10:00:00" },
            { name: "Apartment Complex", address: "Green Residency, Richmond Town", ward: "Ward 12", lat: 12.9890, lon: 77.6200, time: "10:20:00" },

            // Jayanagar / Basavanagudi (Ward 13)
            { name: "Jayanagar 4th Block", address: "4th Block Complex", ward: "Ward 13", lat: 12.9250, lon: 77.5938, time: "09:00:00" },
            { name: "Jayanagar Shopping Complex", address: "11th Main Road", ward: "Ward 13", lat: 12.9285, lon: 77.5850, time: "09:25:00" },
            { name: "South End Circle", address: "South End Road", ward: "Ward 13", lat: 12.9360, lon: 77.5800, time: "09:50:00" },
            { name: "Basavanagudi Market", address: "Gandhi Bazaar", ward: "Ward 13", lat: 12.9420, lon: 77.5730, time: "10:15:00" },
            { name: "Lalbagh Gate", address: "Lalbagh West Gate", ward: "Ward 13", lat: 12.9500, lon: 77.5840, time: "10:40:00" },

            // Malleshwaram / Rajajinagar (Ward 14)
            { name: "Malleshwaram 8th Cross", address: "8th Cross Road", ward: "Ward 14", lat: 12.9988, lon: 77.5705, time: "09:00:00" },
            { name: "Mantri Mall", address: "Sampige Road", ward: "Ward 14", lat: 12.9915, lon: 77.5712, time: "09:30:00" },
            { name: "Rajajinagar 1st Block", address: "Chord Road", ward: "Ward 14", lat: 12.9880, lon: 77.5550, time: "10:00:00" },
            { name: "Navrang Junction", address: "Rajajinagar Main Road", ward: "Ward 14", lat: 12.9950, lon: 77.5520, time: "10:30:00" },
            { name: "Orion Mall Area", address: "Brigade Gateway", ward: "Ward 14", lat: 13.0110, lon: 77.5550, time: "11:00:00" },

            // Whitefield (Ward 15)
            { name: "Whitefield Main Road", address: "Whitefield Post Office", ward: "Ward 15", lat: 12.9698, lon: 77.7499, time: "09:00:00" },
            { name: "ITPL Main Gate", address: "ITPL Main Road", ward: "Ward 15", lat: 12.9860, lon: 77.7380, time: "09:30:00" },
            { name: "Hope Farm", address: "Hope Farm Junction", ward: "Ward 15", lat: 12.9840, lon: 77.7510, time: "10:00:00" },
            { name: "Kadugodi Park", address: "Kadugodi Main Road", ward: "Ward 15", lat: 12.9980, lon: 77.7610, time: "10:30:00" },
            { name: "Whitefield Railway Station", address: "Kadugodi Road", ward: "Ward 15", lat: 13.0030, lon: 77.7580, time: "11:00:00" },

            // Indiranagar / Brookefield (Ward 16)
            { name: "Indiranagar 100ft Road", address: "12th Main Corner", ward: "Ward 16", lat: 12.9784, lon: 77.6408, time: "09:00:00" },
            { name: "Brookefield Market", address: "Kundalahalli Main Road", ward: "Ward 16", lat: 12.9640, lon: 77.7120, time: "09:30:00" },
            { name: "AECS Layout", address: "ITPL Access Road", ward: "Ward 16", lat: 12.9610, lon: 77.7180, time: "10:00:00" },
            { name: "Kadugodi Tree Park", address: "Channasandra Road", ward: "Ward 16", lat: 12.9910, lon: 77.7520, time: "10:30:00" },
            { name: "Whitefield Bus Stand", address: "Whitefield Circle", ward: "Ward 16", lat: 12.9705, lon: 77.7480, time: "11:00:00" }
        ];

        for (const cp of collectionPointsData) {
            const existing = await pool.query(`SELECT id FROM collection_points WHERE name = $1`, [cp.name]);
            if (existing.rows.length === 0) {
                await pool.query(`
                    INSERT INTO collection_points (name, address, ward, latitude, longitude, scheduled_time)
                    VALUES ($1, $2, $3, $4, $5, $6);
                `, [cp.name, cp.address, cp.ward, cp.lat, cp.lon, cp.time]);
            }
        }

        // 7. Seed Routes for today and target test dates
        const todayStr = new Date().toISOString().split("T")[0];
        const testDates = [todayStr, "2026-09-13", "2026-09-20"];

        for (const rDate of testDates) {
            for (let vId = 1; vId <= 5; vId++) {
                const existing = await pool.query(`SELECT id FROM routes WHERE vehicle_id = $1 AND route_date = $2`, [vId, rDate]);
                if (existing.rows.length === 0) {
                    await pool.query(`
                        INSERT INTO routes (vehicle_id, route_date, status, total_distance, estimated_time)
                        VALUES ($1, $2, 'PLANNED', 0.00, 0);
                    `, [vId, rDate]);
                }
            }
        }

        // 8. Seed Sample Complaints
        const citizenRes = await pool.query(`SELECT id FROM users WHERE role = 'CITIZEN' LIMIT 1`);
        const citizenId = citizenRes.rows[0]?.id || 1;

        const sampleComplaints = [
            { category: "Missed Collection", desc: "The waste collection vehicle did not visit Green Park today.", lat: 12.9716, lon: 77.5946, status: "PENDING" },
            { category: "Waste Leakage", desc: "Spilled liquid waste near the Main Market area.", lat: 12.9752, lon: 77.6012, status: "IN_PROGRESS" },
            { category: "Overflowing Waste", desc: "Bins are overflowing near Lake View Park.", lat: 12.9801, lon: 77.6105, status: "RESOLVED" }
        ];

        for (const c of sampleComplaints) {
            const existing = await pool.query(`SELECT id FROM complaints WHERE description = $1`, [c.desc]);
            if (existing.rows.length === 0) {
                await pool.query(`
                    INSERT INTO complaints (citizen_id, category, description, latitude, longitude, priority, status, created_at)
                    VALUES ($1, $2, $3, $4, $5, 'HIGH', $6, CURRENT_TIMESTAMP);
                `, [citizenId, c.category, c.desc, c.lat, c.lon, c.status]);
            }
        }

        // 9. Seed Sample Activity Logs
        const activityLogsData = [
            { event: "VEHICLE_ARRIVED", desc: "Vehicle KA03EF9012 reached Green Park Collection Point", vehicle_id: vehicleMap["KA03EF9012"] },
            { event: "VEHICLE_EN_ROUTE", desc: "Vehicle KA01AB1234 is en route to Market Area", vehicle_id: vehicleMap["KA01AB1234"] },
            { event: "COLLECTION_COMPLETED", desc: "Collection completed at Ward 12", vehicle_id: vehicleMap["KA01AB1234"] },
            { event: "COLLECTION_MISSED", desc: "Missed collection reported at Ward 13", vehicle_id: vehicleMap["KA02CD5678"] }
        ];

        for (const act of activityLogsData) {
            await pool.query(`
                INSERT INTO activity_logs (event_type, description, vehicle_id)
                VALUES ($1, $2, $3);
            `, [act.event, act.desc, act.vehicle_id || null]);
        }

        console.log("✅ Database seeding completed successfully.");
    } catch (err) {
        console.error("❌ Seeding error:", err);
    } finally {
        await pool.end();
    }
}

seedDatabase();
