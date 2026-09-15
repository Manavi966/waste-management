const express = require("express");
const pool = require("../config/db");

const {
    optimizeRoute
} = require("../services/routeOptimizer");

const router = express.Router();

router.get("/:routeId", async (req, res) => {
    try {
        const { routeId } = req.params;

        // Get route information
        const routeResult = await pool.query(
            `SELECT
                r.id,
                r.vehicle_id,
                r.route_date,
                r.status,
                r.total_distance,
                r.estimated_time,
                v.vehicle_number
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

        // Get all stops for this route
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
                cp.latitude,
                cp.longitude,
                cp.scheduled_time
             FROM route_stops rs
             JOIN collection_points cp
                ON rs.collection_point_id = cp.id
             WHERE rs.route_id = $1
             ORDER BY rs.sequence`,
            [routeId]
        );

        res.json({
            route: routeResult.rows[0],
            stops: stopsResult.rows
        });

    } catch (error) {
        console.error("Route fetch error:", error);

        res.status(500).json({
            message: "Failed to fetch route"
        });
    }
});

router.post("/:routeId/optimize", async (req, res) => {
    try {
        const { routeId } = req.params;

        // Get route
        const routeResult = await pool.query(
            `SELECT *
             FROM routes
             WHERE id = $1`,
            [routeId]
        );

        if (routeResult.rows.length === 0) {
            return res.status(404).json({
                message: "Route not found"
            });
        }

        const route = routeResult.rows[0];

        // Get vehicle
        const vehicleResult = await pool.query(
            `SELECT current_latitude, current_longitude
             FROM vehicles
             WHERE id = $1`,
            [route.vehicle_id]
        );

        if (vehicleResult.rows.length === 0) {
            return res.status(404).json({
                message: "Vehicle not found"
            });
        }

        const vehicle = vehicleResult.rows[0];

        // For now, use the first collection point
        // as the starting point if GPS is unavailable.
        let startPoint;

        if (
            vehicle.current_latitude !== null &&
            vehicle.current_longitude !== null
        ) {
            startPoint = {
                latitude: Number(vehicle.current_latitude),
                longitude: Number(vehicle.current_longitude)
            };
        } else {

            const firstPointResult = await pool.query(
                `SELECT
                    cp.latitude,
                    cp.longitude
                 FROM route_stops rs
                 JOIN collection_points cp
                    ON rs.collection_point_id = cp.id
                 WHERE rs.route_id = $1
                 ORDER BY rs.sequence
                 LIMIT 1`,
                [routeId]
            );

            startPoint = {
                latitude: Number(
                    firstPointResult.rows[0].latitude
                ),
                longitude: Number(
                    firstPointResult.rows[0].longitude
                )
            };
        }

        // Get collection points
        const stopsResult = await pool.query(
            `SELECT
                rs.id AS route_stop_id,
                cp.id AS collection_point_id,
                cp.name,
                cp.latitude,
                cp.longitude
             FROM route_stops rs
             JOIN collection_points cp
                ON rs.collection_point_id = cp.id
             WHERE rs.route_id = $1`,
            [routeId]
        );

        const points = stopsResult.rows.map((stop) => ({
            routeStopId: stop.route_stop_id,
            collectionPointId: stop.collection_point_id,
            name: stop.name,
            latitude: Number(stop.latitude),
            longitude: Number(stop.longitude)
        }));

        const result = optimizeRoute(
            points,
            startPoint
        );

        // Save new sequence
        for (
            let i = 0;
            i < result.orderedPoints.length;
            i++
        ) {
            await pool.query(
                `UPDATE route_stops
                 SET sequence = $1
                 WHERE id = $2`,
                [
                    i + 1,
                    result.orderedPoints[i].routeStopId
                ]
            );
        }

        // Save total distance
        await pool.query(
            `UPDATE routes
             SET total_distance = $1
             WHERE id = $2`,
            [
                result.totalDistance.toFixed(2),
                routeId
            ]
        );

        res.json({
            message: "Route optimized successfully",
            total_distance_km:
                Number(result.totalDistance.toFixed(2)),
            optimized_route:
                result.orderedPoints.map(
                    (point, index) => ({
                        sequence: index + 1,
                        name: point.name
                    })
                )
        });

    } catch (error) {

        console.error(
            "Route optimization error:",
            error
        );

        res.status(500).json({
            message: "Failed to optimize route"
        });
    }
});

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

        res.status(500).json({
            message: "Failed to start route"
        });
    }
});

router.post("/stops/:stopId/complete", async (req, res) => {
    try {
        const { stopId } = req.params;
        const { latitude, longitude } = req.body;

        // Validate GPS coordinates
        if (
            latitude === undefined ||
            longitude === undefined
        ) {
            return res.status(400).json({
                message: "Current GPS location is required."
            });
        }

        // Get collection point coordinates
        const stopResult = await pool.query(
            `SELECT
                rs.id,
                rs.status,
                rs.collection_point_id,
                cp.name,
                cp.latitude,
                cp.longitude
             FROM route_stops rs
             JOIN collection_points cp
                ON rs.collection_point_id = cp.id
             WHERE rs.id = $1`,
            [stopId]
        );

        if (stopResult.rows.length === 0) {
            return res.status(404).json({
                message: "Route stop not found."
            });
        }

        const stop = stopResult.rows[0];

        // Convert coordinates to numbers
        const driverLat = Number(latitude);
        const driverLon = Number(longitude);

        const pointLat = Number(stop.latitude);
        const pointLon = Number(stop.longitude);

        // Haversine distance calculation
        const R = 6371000; // Earth radius in meters

        const lat1 = driverLat * Math.PI / 180;
        const lat2 = pointLat * Math.PI / 180;

        const deltaLat =
            (pointLat - driverLat) * Math.PI / 180;

        const deltaLon =
            (pointLon - driverLon) * Math.PI / 180;

        const a =
            Math.sin(deltaLat / 2) *
            Math.sin(deltaLat / 2) +
            Math.cos(lat1) *
            Math.cos(lat2) *
            Math.sin(deltaLon / 2) *
            Math.sin(deltaLon / 2);

        const c =
            2 * Math.atan2(
                Math.sqrt(a),
                Math.sqrt(1 - a)
            );

        const distance = R * c;

        console.log(
            `Driver distance from ${stop.name}: ${distance.toFixed(2)} meters`
        );

        // Maximum allowed distance = 100 meters
        const MAX_DISTANCE = 100;

        if (distance > MAX_DISTANCE) {
            return res.status(400).json({
                message:
                    `You are ${distance.toFixed(0)} meters away from ${stop.name}. You must be within ${MAX_DISTANCE} meters to mark this location as collected.`,
                distance: Math.round(distance),
                required_distance: MAX_DISTANCE
            });
        }

        // Complete the stop
        const result = await pool.query(
            `UPDATE route_stops
             SET
                status = 'COMPLETED',
                actual_arrival =
                    COALESCE(actual_arrival, CURRENT_TIMESTAMP),
                actual_departure = CURRENT_TIMESTAMP
             WHERE id = $1
             RETURNING *`,
            [stopId]
        );

        res.json({
            message:
                `Collection at ${stop.name} verified successfully.`,
            distance: Math.round(distance),
            stop: result.rows[0]
        });

    } catch (error) {
        console.error(
            "Complete stop error:",
            error
        );

        res.status(500).json({
            message:
                "Failed to verify collection point."
        });
    }
});

router.post("/stops/:stopId/miss", async (req, res) => {
    try {
        const { stopId } = req.params;
        const { reason } = req.body;

        // Validate reason
        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                message: "A reason is required for missing a location."
            });
        }

        // Check that the stop exists
        const stopResult = await pool.query(
            `SELECT
                rs.id,
                rs.status,
                cp.name
             FROM route_stops rs
             JOIN collection_points cp
                ON rs.collection_point_id = cp.id
             WHERE rs.id = $1`,
            [stopId]
        );

        if (stopResult.rows.length === 0) {
            return res.status(404).json({
                message: "Route stop not found."
            });
        }

        const stop = stopResult.rows[0];

        // Don't allow an already completed stop to be marked missed
        if (stop.status === "COMPLETED") {
            return res.status(400).json({
                message: "This collection point is already completed."
            });
        }

        // Mark stop as MISSED
        const result = await pool.query(
            `UPDATE route_stops
             SET
                status = 'MISSED',
                miss_reason = $1
             WHERE id = $2
             RETURNING *`,
            [reason.trim(), stopId]
        );

        res.json({
            message:
                `Collection point ${stop.name} marked as missed.`,
            stop: result.rows[0]
        });

    } catch (error) {
        console.error(
            "Mark missed error:",
            error
        );

        res.status(500).json({
            message:
                "Failed to mark collection point as missed."
        });
    }
});

// Automatically assign nearest unique collection points to routes
router.post("/auto-assign", async (req, res) => {
    try {
        // Get today's routes and vehicle GPS locations
        const routesResult = await pool.query(`
            SELECT
                r.id AS route_id,
                r.vehicle_id,
                v.vehicle_number,
                v.current_latitude,
                v.current_longitude
            FROM routes r
            JOIN vehicles v
                ON r.vehicle_id = v.id
            WHERE r.route_date = CURRENT_DATE
              AND v.current_latitude IS NOT NULL
              AND v.current_longitude IS NOT NULL
            ORDER BY r.id
        `);

        if (routesResult.rows.length === 0) {
            return res.status(400).json({
                message:
                    "No routes with vehicle GPS locations found."
            });
        }

        // Get all collection points
        const pointsResult = await pool.query(`
            SELECT
                id,
                name,
                address,
                ward,
                latitude,
                longitude,
                scheduled_time
            FROM collection_points
            WHERE latitude IS NOT NULL
              AND longitude IS NOT NULL
            ORDER BY id
        `);

        if (pointsResult.rows.length === 0) {
            return res.status(400).json({
                message: "No collection points found."
            });
        }

        // Haversine distance in kilometres
        const calculateDistance = (
            lat1,
            lon1,
            lat2,
            lon2
        ) => {

            const R = 6371;

            const dLat =
                (lat2 - lat1) * Math.PI / 180;

            const dLon =
                (lon2 - lon1) * Math.PI / 180;

            const a =
                Math.sin(dLat / 2) ** 2 +
                Math.cos(lat1 * Math.PI / 180) *
                Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;

            const c =
                2 * Math.atan2(
                    Math.sqrt(a),
                    Math.sqrt(1 - a)
                );

            return R * c;
        };

        /*
         * IMPORTANT:
         * Remove existing PENDING stops for today's routes
         * before creating a new assignment.
         *
         * Completed/MISSED stops are preserved.
         */
        for (const route of routesResult.rows) {

            await pool.query(
                `
                DELETE FROM route_stops
                WHERE route_id = $1
                  AND status = 'PENDING'
                `,
                [route.route_id]
            );
        }

        const assignedPoints = new Set();

        const assignments = [];

        /*
         * Assign 5 unique points to each vehicle.
         */
        for (const route of routesResult.rows) {

            let currentLat =
                Number(route.current_latitude);

            let currentLon =
                Number(route.current_longitude);

            const selectedPoints = [];

            /*
             * Select 5 points one-by-one.
             *
             * Each time we calculate distance from the
             * vehicle's CURRENT position, not its original
             * position.
             */
            for (let i = 0; i < 5; i++) {

                const availablePoints =
                    pointsResult.rows
                        .filter(
                            point =>
                                !assignedPoints.has(point.id)
                        )
                        .map(point => {

                            const distance =
                                calculateDistance(
                                    currentLat,
                                    currentLon,
                                    Number(point.latitude),
                                    Number(point.longitude)
                                );

                            return {
                                ...point,
                                distance
                            };
                        })
                        .sort(
                            (a, b) =>
                                a.distance - b.distance
                        );

                if (availablePoints.length === 0) {
                    break;
                }

                // Nearest point
                const point = availablePoints[0];

                selectedPoints.push(point);

                // Mark as assigned
                assignedPoints.add(point.id);

                /*
                 * The next point is selected from this
                 * collection point.
                 */
                currentLat =
                    Number(point.latitude);

                currentLon =
                    Number(point.longitude);
            }

            /*
             * Save route stops
             */
            for (
                let i = 0;
                i < selectedPoints.length;
                i++
            ) {

                const point =
                    selectedPoints[i];

                await pool.query(
                    `
                    INSERT INTO route_stops
                    (
                        route_id,
                        collection_point_id,
                        sequence,
                        status
                    )
                    VALUES ($1, $2, $3, 'PENDING')
                    `,
                    [
                        route.route_id,
                        point.id,
                        i + 1
                    ]
                );
            }

            /*
             * Save assignment information
             */
            assignments.push({
                route_id:
                    route.route_id,

                vehicle_id:
                    route.vehicle_id,

                vehicle_number:
                    route.vehicle_number,

                collection_points:
                    selectedPoints.map(
                        (point, index) => ({
                            sequence:
                                index + 1,

                            id:
                                point.id,

                            name:
                                point.name,

                            address:
                                point.address,

                            ward:
                                point.ward,

                            latitude:
                                Number(
                                    point.latitude
                                ),

                            longitude:
                                Number(
                                    point.longitude
                                ),

                            distance_from_previous_km:
                                Number(
                                    point.distance
                                        .toFixed(2)
                                )
                        })
                    )
            });
        }

        res.json({
            message:
                "Collection points assigned successfully.",

            total_routes:
                routesResult.rows.length,

            total_collection_points_assigned:
                assignedPoints.size,

            assignments
        });

    } catch (error) {

        console.error(
            "Auto assignment error:",
            error
        );

        res.status(500).json({
            message:
                "Failed to assign collection points.",
            error:
                error.message
        });
    }
});

module.exports = router;