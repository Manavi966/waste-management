const { calculateHaversineDistance, getTravelTime } = require("./trafficService");

/**
 * Optimizes the route sequence starting from vehicle position
 * @param {Array} points Array of collection points
 * @param {Object} startPoint Vehicle starting position { latitude, longitude }
 */
function optimizeRoute(points, startPoint) {
    const remaining = [...points];
    const orderedPoints = [];
    let currentPoint = startPoint;
    let totalDistance = 0;
    let accumulatedMinutes = 0;

    const startTime = new Date();

    while (remaining.length > 0) {
        let nearestIndex = 0;
        let nearestDistance = Infinity;

        for (let i = 0; i < remaining.length; i++) {
            const point = remaining[i];
            const distance = calculateHaversineDistance(
                currentPoint.latitude,
                currentPoint.longitude,
                point.latitude,
                point.longitude
            );

            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = i;
            }
        }

        const nearestPoint = remaining[nearestIndex];
        
        // Calculate travel time for segment (avg 25 km/h)
        const segmentMinutes = Math.max(Math.round((nearestDistance / 25) * 60), 2);
        accumulatedMinutes += segmentMinutes;

        const eta = new Date(startTime.getTime() + accumulatedMinutes * 60000);
        const etaTimeString = eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        orderedPoints.push({
            ...nearestPoint,
            distanceFromPreviousKm: Number(nearestDistance.toFixed(2)),
            segmentMinutes,
            eta: etaTimeString
        });

        totalDistance += nearestDistance;
        currentPoint = nearestPoint;
        remaining.splice(nearestIndex, 1);
    }

    const estimatedTotalMinutes = Math.max(Math.round((totalDistance / 25) * 60), 5);

    return {
        orderedPoints,
        totalDistance: Number(totalDistance.toFixed(2)),
        estimatedTotalMinutes
    };
}

module.exports = {
    calculateDistance: calculateHaversineDistance,
    optimizeRoute
};