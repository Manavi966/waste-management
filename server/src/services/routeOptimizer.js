function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;

    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c =
        2 * Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return R * c;
}

function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}


function optimizeRoute(points, startPoint) {
    const remaining = [...points];

    const orderedPoints = [];

    let currentPoint = startPoint;

    let totalDistance = 0;

    while (remaining.length > 0) {

        let nearestIndex = 0;

        let nearestDistance = Infinity;

        for (let i = 0; i < remaining.length; i++) {

            const point = remaining[i];

            const distance = calculateDistance(
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

        orderedPoints.push(nearestPoint);

        totalDistance += nearestDistance;

        currentPoint = nearestPoint;

        remaining.splice(nearestIndex, 1);
    }

    return {
        orderedPoints,
        totalDistance
    };
}


module.exports = {
    calculateDistance,
    optimizeRoute
};