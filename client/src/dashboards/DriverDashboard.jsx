import { useEffect, useState, useRef } from "react";
import api from "../services/api";
import Navbar from "../components/Navbar";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

// Map Controller for custom map buttons ("My Location" & "Fit Route")
function MapController({ vehicleLocation, stops, actionTrigger }) {
    const map = useMap();

    useEffect(() => {
        if (!actionTrigger) return;

        if (actionTrigger.type === "MY_LOCATION" && vehicleLocation) {
            map.flyTo([vehicleLocation.latitude, vehicleLocation.longitude], 16, { animate: true, duration: 1.2 });
        } else if (actionTrigger.type === "FIT_ROUTE") {
            const points = [];
            if (vehicleLocation) points.push([vehicleLocation.latitude, vehicleLocation.longitude]);
            stops.forEach((s) => {
                const cp = s.collection_point || s;
                if (cp.latitude && cp.longitude) {
                    points.push([Number(cp.latitude), Number(cp.longitude)]);
                }
            });

            if (points.length > 0) {
                const bounds = L.latLngBounds(points);
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
            }
        }
    }, [actionTrigger, vehicleLocation, stops, map]);

    // Initial bounding
    useEffect(() => {
        const points = [];
        if (vehicleLocation) points.push([vehicleLocation.latitude, vehicleLocation.longitude]);
        stops.forEach((s) => {
            const cp = s.collection_point || s;
            if (cp.latitude && cp.longitude) {
                points.push([Number(cp.latitude), Number(cp.longitude)]);
            }
        });

        if (points.length > 0) {
            const bounds = L.latLngBounds(points);
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
    }, [map]);

    return null;
}

// Custom vehicle "You are here" marker
const createVehicleMarker = (vehicleNumber) => {
    return L.divIcon({
        className: "custom-driver-vehicle-marker",
        html: `<div style="
            display: flex;
            align-items: center;
            gap: 6px;
            background: linear-gradient(135deg, #047857, #065f46);
            color: white;
            padding: 5px 10px;
            border-radius: 20px;
            font-weight: 800;
            font-size: 12px;
            border: 2px solid #ffffff;
            box-shadow: 0 4px 10px rgba(0,0,0,0.35);
            white-space: nowrap;
        ">
            <span style="font-size: 14px;">🚛</span>
            <span>You are here (${vehicleNumber || "Vehicle"})</span>
        </div>`,
        iconSize: [170, 32],
        iconAnchor: [85, 16],
        popupAnchor: [0, -16]
    });
};

// Custom numbered status pin for collection points
const createStopPin = (sequence, status, isNext = false) => {
    let bgColor = "#f59e0b"; // Yellow/Amber for PENDING
    let iconSymbol = sequence;
    let ringEffect = isNext ? "border: 3px solid #3b82f6; box-shadow: 0 0 0 4px rgba(59,130,246,0.4);" : "border: 2px solid white;";

    if (status === "COMPLETED") {
        bgColor = "#16a34a"; // Green
        iconSymbol = `✓ ${sequence}`;
    } else if (status === "MISSED") {
        bgColor = "#dc2626"; // Red
        iconSymbol = `✕ ${sequence}`;
    }

    return L.divIcon({
        className: "custom-stop-pin",
        html: `<div style="
            background-color: ${bgColor};
            color: white;
            border-radius: 18px;
            min-width: 32px;
            height: 32px;
            padding: 0 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 13px;
            ${ringEffect}
            box-shadow: 0 3px 6px rgba(0,0,0,0.35);
            white-space: nowrap;
        ">${iconSymbol}</div>`,
        iconSize: [40, 32],
        iconAnchor: [20, 16],
        popupAnchor: [0, -16]
    });
};

function DriverDashboard({ user, onLogout }) {
    const [vehicle, setVehicle] = useState(null);
    const [route, setRoute] = useState(null);
    const [stops, setStops] = useState([]);
    const [nextStop, setNextStop] = useState(null);
    const [summary, setSummary] = useState({ total_stops: 0, completed_count: 0, pending_count: 0, missed_count: 0, progress_percent: 0 });
    const [gps, setGps] = useState(null);

    const [selectedDate, setSelectedDate] = useState("2026-09-20");
    const [gpsTrackingActive, setGpsTrackingActive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [updatingStop, setUpdatingStop] = useState(null);
    const [missModalStopId, setMissModalStopId] = useState(null);
    const [missReason, setMissReason] = useState("Heavy Traffic");

    // Action trigger for MapController
    const [mapAction, setMapAction] = useState(null);

    const pollingRef = useRef(null);
    const watchIdRef = useRef(null);

    // Fetch driver route from backend
    const fetchDriverRoute = async (dateToUse = selectedDate) => {
        try {
            setError("");
            const response = await api.get(`/routes/driver/my-route?driver_id=${user.id}&date=${dateToUse}`);
            const data = response.data;

            setVehicle(data.vehicle);
            setRoute(data.route);
            setStops(data.stops || []);
            setNextStop(data.next_stop || null);
            setSummary(data.summary || { total_stops: 0, completed_count: 0, pending_count: 0, missed_count: 0, progress_percent: 0 });
            setGps(data.gps || null);
        } catch (err) {
            console.error("Failed to load driver route:", err);
            setError("Failed to load driver route information.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDriverRoute(selectedDate);
    }, [user.id, selectedDate]);

    // Periodically poll for GPS updates and route changes every 8 seconds
    useEffect(() => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = setInterval(() => {
            fetchDriverRoute(selectedDate);
        }, 8000);

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [user.id, selectedDate]);

    // Toggle live GPS broadcasting
    const toggleGPSTracking = () => {
        if (gpsTrackingActive) {
            if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
            }
            setGpsTrackingActive(false);
            return;
        }

        if (!navigator.geolocation) {
            alert("GPS is not supported by this device.");
            return;
        }

        if (!vehicle) {
            alert("No vehicle is assigned to your account.");
            return;
        }

        setGpsTrackingActive(true);

        watchIdRef.current = navigator.geolocation.watchPosition(
            async (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;
                const speed = position.coords.speed !== null ? position.coords.speed * 3.6 : 0;

                setGps((prev) => ({
                    ...(prev || {}),
                    latitude,
                    longitude,
                    speed,
                    last_updated: new Date().toISOString(),
                    minutes_ago: 0
                }));

                try {
                    await api.post("/gps", {
                        vehicle_id: vehicle.id,
                        latitude,
                        longitude,
                        speed
                    });
                } catch (err) {
                    console.error("Error sending GPS position:", err);
                }
            },
            (err) => {
                console.error("GPS tracking error:", err);
                setGpsTrackingActive(false);
                alert("GPS permission was denied or signal is unavailable.");
            },
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
        );
    };

    // Complete collection stop with geofence check
    const completeStop = async (stopId, stopLat, stopLng) => {
        try {
            setUpdatingStop(stopId);

            const performCompletion = async (lat, lon) => {
                try {
                    const response = await api.post(`/routes/stops/${stopId}/complete`, { latitude: lat, longitude: lon });
                    alert(`✓ ${response.data.message || "Collection marked as completed!"}`);
                    await fetchDriverRoute(selectedDate);
                } catch (err) {
                    const msg = err.response?.data?.message || "Unable to complete collection point.";
                    alert(`⚠️ ${msg}`);
                } finally {
                    setUpdatingStop(null);
                }
            };

            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => performCompletion(pos.coords.latitude, pos.coords.longitude),
                    () => performCompletion(Number(stopLat), Number(stopLng)),
                    { enableHighAccuracy: true, timeout: 5000 }
                );
            } else {
                performCompletion(Number(stopLat), Number(stopLng));
            }
        } catch (err) {
            console.error("Stop completion error:", err);
            setUpdatingStop(null);
        }
    };

    // Report stop as missed
    const handleConfirmMiss = async () => {
        if (!missModalStopId) return;
        try {
            setUpdatingStop(missModalStopId);
            const response = await api.post(`/routes/stops/${missModalStopId}/miss`, { reason: missReason });
            alert(`⚠️ ${response.data.message || "Location marked as missed."}`);
            setMissModalStopId(null);
            await fetchDriverRoute(selectedDate);
        } catch (err) {
            alert(err.response?.data?.message || "Failed to mark stop as missed.");
        } finally {
            setUpdatingStop(null);
        }
    };

    if (loading) {
        return (
            <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "'Inter', sans-serif" }}>
                <Navbar user={user} onLogout={onLogout} />
                <div style={{ padding: "40px", textAlign: "center", color: "#64748b" }}>
                    Loading Driver Navigation Dashboard...
                </div>
            </div>
        );
    }

    // Vehicle position
    const vehiclePosition = gps && gps.latitude && gps.longitude
        ? { latitude: gps.latitude, longitude: gps.longitude }
        : vehicle && vehicle.current_latitude && vehicle.current_longitude
            ? { latitude: Number(vehicle.current_latitude), longitude: Number(vehicle.current_longitude) }
            : null;

    // Ordered route polyline: Vehicle Location -> Stop 1 -> Stop 2 -> Stop 3...
    const routePolyline = [];
    if (vehiclePosition) {
        routePolyline.push([vehiclePosition.latitude, vehiclePosition.longitude]);
    }
    stops.forEach((s) => {
        const cp = s.collection_point || s;
        if (cp.latitude && cp.longitude) {
            routePolyline.push([Number(cp.latitude), Number(cp.longitude)]);
        }
    });

    const defaultCenter = vehiclePosition
        ? [vehiclePosition.latitude, vehiclePosition.longitude]
        : stops.length > 0 && stops[0].collection_point?.latitude
            ? [stops[0].collection_point.latitude, stops[0].collection_point.longitude]
            : [12.9716, 77.5946];

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#0f172a", color: "#f8fafc", fontFamily: "'Inter', sans-serif" }}>
            <Navbar user={user} onLogout={onLogout} />

            <main style={{ padding: "16px", maxWidth: "1250px", margin: "0 auto" }}>
                {/* TOP HEADER BAR */}
                <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "12px",
                    marginBottom: "16px",
                    backgroundColor: "#1e293b",
                    padding: "12px 20px",
                    borderRadius: "12px",
                    border: "1px solid #334155"
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ fontSize: "28px" }}>🚛</span>
                        <div>
                            <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#94a3b8", fontWeight: "700", letterSpacing: "0.5px" }}>
                                Navigation Mode • Driver Portal
                            </div>
                            <div style={{ fontSize: "20px", fontWeight: "800", color: "#34d399" }}>
                                {vehicle ? vehicle.vehicle_number : "No Vehicle Assigned"}
                                <span style={{ fontSize: "14px", fontWeight: "600", color: "#94a3b8", marginLeft: "8px" }}>
                                    ({user?.name || "Driver"})
                                </span>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {/* Operation Date Selector */}
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", backgroundColor: "#0f172a", padding: "6px 12px", borderRadius: "8px", border: "1px solid #334155" }}>
                            <span style={{ fontSize: "12px", color: "#94a3b8" }}>📅 Date:</span>
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => {
                                    setSelectedDate(e.target.value);
                                    fetchDriverRoute(e.target.value);
                                }}
                                style={{
                                    backgroundColor: "transparent",
                                    border: "none",
                                    color: "#f8fafc",
                                    fontSize: "13px",
                                    fontWeight: "600",
                                    outline: "none"
                                }}
                            />
                        </div>

                        {/* GPS Broadcast Toggle */}
                        <button
                            onClick={toggleGPSTracking}
                            style={{
                                backgroundColor: gpsTrackingActive ? "#059669" : "#334155",
                                color: "white",
                                border: "none",
                                padding: "8px 14px",
                                borderRadius: "8px",
                                fontWeight: "700",
                                fontSize: "12px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px"
                            }}
                        >
                            <span>{gpsTrackingActive ? "● GPS Broadcasting" : "○ Start GPS"}</span>
                        </button>
                    </div>
                </div>

                {error && (
                    <div style={{ backgroundColor: "#7f1d1d", color: "#fecaca", padding: "12px 16px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px", fontWeight: "600" }}>
                        ⚠️ {error}
                    </div>
                )}

                {/* GOOGLE-MAPS-LIKE NEXT STOP TURN CARD */}
                {nextStop ? (
                    <div style={{
                        backgroundColor: "#065f46",
                        border: "2px solid #10b981",
                        borderRadius: "14px",
                        padding: "16px 20px",
                        marginBottom: "16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "16px",
                        boxShadow: "0 4px 15px rgba(4,120,87,0.4)"
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                            <div style={{
                                width: "48px",
                                height: "48px",
                                borderRadius: "50%",
                                backgroundColor: "#10b981",
                                color: "#064e3b",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: "900",
                                fontSize: "20px"
                            }}>
                                {nextStop.sequence}
                            </div>
                            <div>
                                <div style={{ fontSize: "12px", color: "#a7f3d0", textTransform: "uppercase", fontWeight: "800", letterSpacing: "0.5px" }}>
                                    Next Collection Point • Stop {nextStop.sequence} of {summary.total_stops}
                                </div>
                                <div style={{ fontSize: "22px", fontWeight: "900", color: "#ffffff", marginTop: "2px" }}>
                                    📍 {nextStop.collection_point?.name}
                                </div>
                                <div style={{ fontSize: "13px", color: "#d1fae5", marginTop: "2px" }}>
                                    {nextStop.collection_point?.ward} • {nextStop.collection_point?.address}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                            <div style={{ textAlign: "right" }}>
                                <div style={{ fontSize: "11px", color: "#a7f3d0", fontWeight: "700", textTransform: "uppercase" }}>Distance to Point</div>
                                <div style={{ fontSize: "22px", fontWeight: "900", color: "#ffffff" }}>
                                    {nextStop.distance_from_vehicle_km !== null ? `${nextStop.distance_from_vehicle_km} km` : "Approaching"}
                                </div>
                            </div>

                            <button
                                onClick={() => completeStop(nextStop.id, nextStop.collection_point?.latitude, nextStop.collection_point?.longitude)}
                                disabled={updatingStop === nextStop.id}
                                style={{
                                    backgroundColor: "#ffffff",
                                    color: "#065f46",
                                    padding: "10px 20px",
                                    borderRadius: "8px",
                                    border: "none",
                                    fontWeight: "800",
                                    fontSize: "14px",
                                    cursor: "pointer",
                                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)"
                                }}
                            >
                                {updatingStop === nextStop.id ? "Checking GPS..." : "✓ Complete Stop"}
                            </button>
                        </div>
                    </div>
                ) : stops.length > 0 ? (
                    <div style={{ backgroundColor: "#1e293b", padding: "14px 20px", borderRadius: "12px", border: "1px solid #334155", marginBottom: "16px", color: "#34d399", fontWeight: "700", fontSize: "14px" }}>
                        🎉 All collection stops for this route have been completed or addressed!
                    </div>
                ) : null}

                {/* MAIN GRID: MAP (LARGE) & TURN-BY-TURN LIST */}
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "16px", alignItems: "start" }}>

                    {/* INTERACTIVE NAVIGATION MAP */}
                    <div style={{ backgroundColor: "#1e293b", borderRadius: "14px", border: "1px solid #334155", padding: "16px", position: "relative" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "18px" }}>🗺️</span>
                                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#f8fafc" }}>
                                    Optimized Route Navigation Map
                                </h3>
                            </div>

                            {/* In-Map Action Controls */}
                            <div style={{ display: "flex", gap: "8px" }}>
                                <button
                                    onClick={() => setMapAction({ type: "MY_LOCATION", ts: Date.now() })}
                                    style={{
                                        backgroundColor: "#0f172a",
                                        color: "#34d399",
                                        border: "1px solid #334155",
                                        padding: "6px 12px",
                                        borderRadius: "6px",
                                        fontSize: "12px",
                                        fontWeight: "700",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "4px"
                                    }}
                                >
                                    📍 My Location
                                </button>
                                <button
                                    onClick={() => setMapAction({ type: "FIT_ROUTE", ts: Date.now() })}
                                    style={{
                                        backgroundColor: "#0f172a",
                                        color: "#60a5fa",
                                        border: "1px solid #334155",
                                        padding: "6px 12px",
                                        borderRadius: "6px",
                                        fontSize: "12px",
                                        fontWeight: "700",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "4px"
                                    }}
                                >
                                    🗺️ Fit Route
                                </button>
                            </div>
                        </div>

                        {/* Leaflet Map Frame */}
                        <div style={{ height: "520px", borderRadius: "10px", overflow: "hidden", border: "1px solid #334155" }}>
                            <MapContainer
                                center={defaultCenter}
                                zoom={14}
                                style={{ height: "100%", width: "100%" }}
                            >
                                <TileLayer
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                />

                                <MapController
                                    vehicleLocation={vehiclePosition}
                                    stops={stops}
                                    actionTrigger={mapAction}
                                />

                                {/* Vehicle Location Marker */}
                                {vehiclePosition && (
                                    <Marker
                                        position={[vehiclePosition.latitude, vehiclePosition.longitude]}
                                        icon={createVehicleMarker(vehicle?.vehicle_number)}
                                    >
                                        <Popup>
                                            <div style={{ color: "#0f172a", fontSize: "13px" }}>
                                                <strong>🚛 Vehicle {vehicle?.vehicle_number}</strong><br />
                                                Driver: {vehicle?.driver_name}<br />
                                                Status: <strong>{vehicle?.status}</strong><br />
                                                Speed: {gps?.speed || 0} km/h
                                            </div>
                                        </Popup>
                                    </Marker>
                                )}

                                {/* Polyline connecting vehicle to all stops in sequence */}
                                {routePolyline.length > 1 && (
                                    <Polyline
                                        positions={routePolyline}
                                        color="#10b981"
                                        weight={5}
                                        opacity={0.85}
                                        dashArray="6, 8"
                                    />
                                )}

                                {/* Waypoint Markers for each stop */}
                                {stops.map((stop) => {
                                    const cp = stop.collection_point || stop;
                                    if (!cp.latitude || !cp.longitude) return null;
                                    const isNext = nextStop && nextStop.id === stop.id;

                                    return (
                                        <Marker
                                            key={stop.id}
                                            position={[Number(cp.latitude), Number(cp.longitude)]}
                                            icon={createStopPin(stop.sequence, stop.status, isNext)}
                                        >
                                            <Popup>
                                                <div style={{ color: "#0f172a", fontSize: "13px" }}>
                                                    <strong>Stop #{stop.sequence}: {cp.name}</strong><br />
                                                    📍 {cp.address} ({cp.ward})<br />
                                                    🕐 Scheduled: {cp.scheduled_time || "09:00 AM"}<br />
                                                    Status: <strong style={{
                                                        color: stop.status === "COMPLETED" ? "#15803d" : stop.status === "MISSED" ? "#b91c1c" : "#b45309"
                                                    }}>{stop.status}</strong>
                                                </div>
                                            </Popup>
                                        </Marker>
                                    );
                                })}
                            </MapContainer>
                        </div>

                        {/* Map Legend */}
                        <div style={{ display: "flex", gap: "16px", marginTop: "12px", fontSize: "12px", color: "#94a3b8", justifyContent: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#f59e0b", display: "inline-block" }}></span>
                                <span>🟡 Pending Stop</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#16a34a", display: "inline-block" }}></span>
                                <span>🟢 Completed</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#dc2626", display: "inline-block" }}></span>
                                <span>🔴 Missed</span>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: PROGRESS & ORDERED TURN-BY-TURN LIST */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        {/* ROUTE PROGRESS CARD */}
                        <div style={{ backgroundColor: "#1e293b", borderRadius: "14px", border: "1px solid #334155", padding: "18px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                <span style={{ fontSize: "13px", fontWeight: "700", color: "#94a3b8", textTransform: "uppercase" }}>
                                    Route Progress
                                </span>
                                <span style={{ fontSize: "14px", fontWeight: "800", color: "#34d399" }}>
                                    {summary.completed_count} / {summary.total_stops} completed ({summary.progress_percent}%)
                                </span>
                            </div>

                            {/* Visual Progress Bar */}
                            <div style={{ width: "100%", height: "8px", backgroundColor: "#0f172a", borderRadius: "4px", overflow: "hidden", marginBottom: "14px" }}>
                                <div style={{ width: `${summary.progress_percent}%`, height: "100%", backgroundColor: "#10b981", transition: "width 0.4s ease" }} />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", textAlign: "center" }}>
                                <div style={{ backgroundColor: "#0f172a", padding: "8px", borderRadius: "8px", border: "1px solid #16a34a33" }}>
                                    <div style={{ fontSize: "11px", color: "#4ade80", fontWeight: "700" }}>COMPLETED</div>
                                    <div style={{ fontSize: "18px", fontWeight: "900", color: "#22c55e" }}>{summary.completed_count}</div>
                                </div>
                                <div style={{ backgroundColor: "#0f172a", padding: "8px", borderRadius: "8px", border: "1px solid #f59e0b33" }}>
                                    <div style={{ fontSize: "11px", color: "#fbbf24", fontWeight: "700" }}>PENDING</div>
                                    <div style={{ fontSize: "18px", fontWeight: "900", color: "#f59e0b" }}>{summary.pending_count}</div>
                                </div>
                                <div style={{ backgroundColor: "#0f172a", padding: "8px", borderRadius: "8px", border: "1px solid #dc262633" }}>
                                    <div style={{ fontSize: "11px", color: "#f87171", fontWeight: "700" }}>MISSED</div>
                                    <div style={{ fontSize: "18px", fontWeight: "900", color: "#ef4444" }}>{summary.missed_count}</div>
                                </div>
                            </div>
                        </div>

                        {/* ORDERED TURN-BY-TURN STOP LIST */}
                        <div style={{ backgroundColor: "#1e293b", borderRadius: "14px", border: "1px solid #334155", padding: "18px", maxHeight: "420px", overflowY: "auto" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "800", color: "#f8fafc", textTransform: "uppercase" }}>
                                    Optimized Sequence (1 → {stops.length})
                                </h4>
                                <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                                    Total: {route?.total_distance_km || "0.00"} km
                                </span>
                            </div>

                            {stops.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "30px", color: "#94a3b8", fontSize: "13px" }}>
                                    No collection stops assigned for {selectedDate}.
                                </div>
                            ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                    {stops.map((stop) => {
                                        const cp = stop.collection_point || stop;
                                        const isCompleted = stop.status === "COMPLETED";
                                        const isMissed = stop.status === "MISSED";
                                        const isNext = nextStop && nextStop.id === stop.id;

                                        return (
                                            <div
                                                key={stop.id}
                                                style={{
                                                    backgroundColor: isNext ? "#064e3b" : "#0f172a",
                                                    padding: "12px 14px",
                                                    borderRadius: "10px",
                                                    border: "1px solid",
                                                    borderColor: isNext ? "#10b981" : isCompleted ? "#16a34a44" : isMissed ? "#dc262644" : "#334155",
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    gap: "10px"
                                                }}
                                            >
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                        <span style={{
                                                            width: "24px",
                                                            height: "24px",
                                                            borderRadius: "50%",
                                                            backgroundColor: isCompleted ? "#16a34a" : isMissed ? "#dc2626" : "#f59e0b",
                                                            color: "white",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center",
                                                            fontWeight: "800",
                                                            fontSize: "12px"
                                                        }}>
                                                            {stop.sequence}
                                                        </span>
                                                        <span style={{ fontWeight: "800", fontSize: "14px", color: "#f8fafc" }}>
                                                            {cp.name}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>
                                                        📍 {cp.address} ({cp.ward})
                                                    </div>
                                                    {isCompleted && (
                                                        <div style={{ fontSize: "11px", color: "#4ade80", marginTop: "2px", fontWeight: "600" }}>
                                                            ✓ Completed at {stop.actual_arrival ? new Date(stop.actual_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Done"}
                                                        </div>
                                                    )}
                                                    {isMissed && (
                                                        <div style={{ fontSize: "11px", color: "#f87171", marginTop: "2px", fontWeight: "600" }}>
                                                            ❌ Reason: {stop.miss_reason || "Missed"}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Action buttons for pending stop */}
                                                {stop.status === "PENDING" && (
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                        <button
                                                            onClick={() => completeStop(stop.id, cp.latitude, cp.longitude)}
                                                            disabled={updatingStop === stop.id}
                                                            style={{
                                                                backgroundColor: "#10b981",
                                                                color: "white",
                                                                padding: "6px 12px",
                                                                borderRadius: "6px",
                                                                border: "none",
                                                                fontWeight: "700",
                                                                fontSize: "12px",
                                                                cursor: "pointer"
                                                            }}
                                                        >
                                                            {updatingStop === stop.id ? "..." : "✓ Done"}
                                                        </button>
                                                        <button
                                                            onClick={() => setMissModalStopId(stop.id)}
                                                            disabled={updatingStop === stop.id}
                                                            style={{
                                                                backgroundColor: "transparent",
                                                                color: "#f87171",
                                                                padding: "4px 8px",
                                                                borderRadius: "6px",
                                                                border: "1px solid #7f1d1d",
                                                                fontWeight: "600",
                                                                fontSize: "11px",
                                                                cursor: "pointer"
                                                            }}
                                                        >
                                                            ✕ Miss
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* Miss Reason Modal */}
            {missModalStopId && (
                <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0,0,0,0.7)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 2000
                }}>
                    <div style={{ backgroundColor: "#1e293b", padding: "24px", borderRadius: "12px", width: "400px", maxWidth: "90%", border: "1px solid #334155" }}>
                        <h3 style={{ marginTop: 0, color: "#f87171", fontSize: "18px" }}>
                            Report Missed Collection Point
                        </h3>
                        <p style={{ fontSize: "13px", color: "#94a3b8", margin: "0 0 16px 0" }}>
                            Please select a reason why this point could not be collected:
                        </p>

                        <div style={{ marginBottom: "20px" }}>
                            <select
                                value={missReason}
                                onChange={(e) => setMissReason(e.target.value)}
                                style={{
                                    width: "100%",
                                    padding: "10px",
                                    borderRadius: "6px",
                                    border: "1px solid #475569",
                                    backgroundColor: "#0f172a",
                                    color: "#f8fafc",
                                    fontSize: "14px"
                                }}
                            >
                                <option value="Heavy Traffic">Heavy Traffic / Road Congestion</option>
                                <option value="Vehicle Breakdown">Vehicle Breakdown / Mechanical Issue</option>
                                <option value="Road Blocked">Road Blocked / Construction</option>
                                <option value="Collection Point Closed">Collection Point Closed / Inaccessible</option>
                                <option value="Emergency">Emergency</option>
                                <option value="Other">Other Operational Reason</option>
                            </select>
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                            <button
                                onClick={() => setMissModalStopId(null)}
                                style={{
                                    padding: "8px 16px",
                                    borderRadius: "6px",
                                    border: "1px solid #475569",
                                    backgroundColor: "transparent",
                                    color: "#f8fafc",
                                    cursor: "pointer"
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmMiss}
                                style={{
                                    padding: "8px 16px",
                                    borderRadius: "6px",
                                    border: "none",
                                    backgroundColor: "#dc2626",
                                    color: "white",
                                    fontWeight: "700",
                                    cursor: "pointer"
                                }}
                            >
                                Confirm Missed
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default DriverDashboard;