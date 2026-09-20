/**
 * CleanTrack Traffic & Travel Time Service Abstraction
 * Separates route sequence optimization (OR-Tools) from traffic/ETA estimations.
 */

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Get estimated travel time between coordinates
 * @param {number} originLat 
 * @param {number} originLon 
 * @param {number} destLat 
 * @param {number} destLon 
 * @param {number} [avgSpeedKmh=25] Default urban waste truck speed in km/h
 */
async function getTravelTime(originLat, originLon, destLat, destLon, avgSpeedKmh = 25) {
    const distanceKm = calculateHaversineDistance(originLat, originLon, destLat, destLon);

    // If an external traffic API key is configured (e.g. Google/HERE/OSRM), we could fetch live traffic data here.
    if (process.env.TRAFFIC_API_PROVIDER && process.env.TRAFFIC_API_KEY) {
        // Plug external provider API call here when key is provided
    }

    // Default distance-based ETA calculation (No fabricated live traffic)
    const travelTimeHours = distanceKm / Math.max(avgSpeedKmh, 1);
    const travelTimeMinutes = Math.round(travelTimeHours * 60);

    return {
        distanceKm: Number(distanceKm.toFixed(2)),
        travelTimeMinutes: Math.max(travelTimeMinutes, 1),
        isLiveTraffic: false,
        provider: "distance-based-estimate"
    };
}

module.exports = {
    calculateHaversineDistance,
    getTravelTime
};
