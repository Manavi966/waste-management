import { useEffect, useState, useRef } from "react";
import api from "../services/api";
import Navbar from "../components/Navbar";
import CheckpointQRScannerModal from "../components/CheckpointQRScannerModal";
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

// Haversine distance in meters calculation
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return null;
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Format distance helper
function formatDistance(meters) {
    if (meters === null || meters === undefined) return "Calculating...";
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
}

// Format seconds into MM:SS
function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const mins = Math.floor(s / 60);
    const remSec = s % 60;
    return `${mins.toString().padStart(2, "0")}:${remSec.toString().padStart(2, "0")}`;
}

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

// Custom vehicle marker
const createVehicleMarker = (vehicleNumber) => {
    return L.divIcon({
        className: "custom-driver-vehicle-marker",
        html: `<div style="
            display: flex;
            align-items: center;
            gap: 6px;
            background: linear-gradient(135deg, #047857, #065f46);
            color: white;
            padding: 5px 12px;
            border-radius: 20px;
            font-weight: 800;
            font-size: 12px;
            border: 2px solid #ffffff;
            box-shadow: 0 4px 10px rgba(0,0,0,0.35);
            white-space: nowrap;
        ">
            <span style="font-size: 15px;">🚛</span>
            <span>You are here (${vehicleNumber || "Vehicle"})</span>
        </div>`,
        iconSize: [180, 32],
        iconAnchor: [90, 16],
        popupAnchor: [0, -16]
    });
};

// Custom numbered status pin for collection points
const createStopPin = (sequence, status, isNext = false) => {
    let bgColor = "#f59e0b"; // Yellow/Amber for PENDING
    let iconSymbol = sequence;
    let ringEffect = isNext
        ? "border: 3px solid #38bdf8; box-shadow: 0 0 0 4px rgba(56,189,248,0.5); transform: scale(1.15);"
        : "border: 2px solid white;";

    if (status === "COMPLETED") {
        bgColor = "#16a34a"; // Green
        iconSymbol = `✓ ${sequence}`;
    } else if (status === "MISSED") {
        bgColor = "#dc2626"; // Red
        iconSymbol = `✕ ${sequence}`;
    } else if (isNext) {
        bgColor = "#0284c7"; // Sky Blue / Star for Next Stop
        iconSymbol = `⭐ ${sequence}`;
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
            transition: all 0.2s ease;
        ">${iconSymbol}</div>`,
        iconSize: [44, 34],
        iconAnchor: [22, 17],
        popupAnchor: [0, -17]
    });
};

function DriverDashboard({ user, onLogout }) {
    const [vehicle, setVehicle] = useState(null);
    const [route, setRoute] = useState(null);
    const [stops, setStops] = useState([]);
    const [nextStop, setNextStop] = useState(null);
    const [summary, setSummary] = useState({ total_stops: 0, completed_count: 0, pending_count: 0, missed_count: 0, progress_percent: 0 });
    const [gps, setGps] = useState(null);
    const [gpsAccuracy, setGpsAccuracy] = useState(null);

    const [selectedDate, setSelectedDate] = useState("2026-09-20");
    const [gpsTrackingActive, setGpsTrackingActive] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [actionLoading, setActionLoading] = useState(false);
    
    // QR Scanner modal state
    const [qrScannerOpen, setQrScannerOpen] = useState(false);

    // Miss modal state
    const [missModalStopId, setMissModalStopId] = useState(null);
    const [missReason, setMissReason] = useState("Heavy Traffic");

    // Live elapsed timer state (updates every second)
    const [liveDwellSeconds, setLiveDwellSeconds] = useState(0);

    // Action trigger for MapController
    const [mapAction, setMapAction] = useState(null);

    const pollingRef = useRef(null);
    const timerRef = useRef(null);
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

            // Synchronize live timer with nextStop dwell start time
            if (data.next_stop?.dwell_start_time && data.next_stop?.status !== "COMPLETED") {
                const elapsed = Math.max(0, Math.floor((Date.now() - new Date(data.next_stop.dwell_start_time).getTime()) / 1000));
                setLiveDwellSeconds(elapsed);
            } else if (!data.next_stop?.dwell_start_time) {
                setLiveDwellSeconds(0);
            }
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

    // Live 1-second interval timer for dwell duration
    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);

        timerRef.current = setInterval(() => {
            if (nextStop?.dwell_start_time && nextStop.status !== "COMPLETED") {
                const elapsed = Math.max(0, Math.floor((Date.now() - new Date(nextStop.dwell_start_time).getTime()) / 1000));
                setLiveDwellSeconds(elapsed);
            }
        }, 1000);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [nextStop?.dwell_start_time, nextStop?.status]);

    // Periodically poll for GPS updates and route changes every 5 seconds
    useEffect(() => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = setInterval(() => {
            fetchDriverRoute(selectedDate);
        }, 5000);

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [user.id, selectedDate]);

    // Clean up geolocation on unmount
    useEffect(() => {
        return () => {
            if (watchIdRef.current !== null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
            }
        };
    }, []);

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
                const accuracy = position.coords.accuracy || null;

                setGpsAccuracy(accuracy);

                setGps((prev) => ({
                    ...(prev || {}),
                    latitude,
                    longitude,
                    speed,
                    recorded_at: new Date().toISOString(),
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

    // Calculate live distance to next stop
    const vehiclePosition = gps && gps.latitude && gps.longitude
        ? { latitude: gps.latitude, longitude: gps.longitude }
        : vehicle && vehicle.current_latitude && vehicle.current_longitude
            ? { latitude: Number(vehicle.current_latitude), longitude: Number(vehicle.current_longitude) }
            : null;

    const nextStopCp = nextStop?.collection_point || nextStop;
    const distanceToNextMeters = (vehiclePosition && nextStopCp && nextStopCp.latitude && nextStopCp.longitude)
        ? calculateDistanceMeters(vehiclePosition.latitude, vehiclePosition.longitude, Number(nextStopCp.latitude), Number(nextStopCp.longitude))
        : null;

    const geofenceRadius = nextStopCp?.geofence_radius_meters || 100;
    const isInsideGeofence = distanceToNextMeters !== null && distanceToNextMeters <= geofenceRadius;

    // Checkpoint & Dwell verification metrics
    const minCollectionSec = Number(nextStopCp?.minimum_collection_time_seconds) || 30;
    const isDwellMet = liveDwellSeconds >= minCollectionSec;
    const totalScanners = nextStop?.total_scanners || (nextStop?.checkpoints?.length) || 3;
    const scannedCount = nextStop?.scanned_count || (nextStop?.checkpoints?.filter(c => c.is_scanned).length) || 0;
    const allScannersScanned = scannedCount >= totalScanners && totalScanners > 0;
    const nextPendingCheckpoint = (nextStop?.checkpoints || []).find(c => !c.is_scanned);

    // Report stop as missed
    const handleConfirmMiss = async () => {
        if (!missModalStopId) return;
        try {
            setActionLoading(true);
            const response = await api.post(`/routes/stops/${missModalStopId}/miss`, { reason: missReason });
            alert(`⚠️ ${response.data.message || "Location marked as missed."}`);
            setMissModalStopId(null);
            await fetchDriverRoute(selectedDate);
        } catch (err) {
            alert(err.response?.data?.message || "Failed to mark stop as missed.");
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return (
            <div style={{ minHeight: "100vh", backgroundColor: "#0f172a", color: "#f8fafc", fontFamily: "'Inter', sans-serif" }}>
                <Navbar user={user} onLogout={onLogout} />
                <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>
                    Loading Driver Verification & Navigation Dashboard...
                </div>
            </div>
        );
    }

    // Ordered route polyline: Vehicle Location -> Next Stop -> Remaining Stops in sequence
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

    // Status text for GPS freshness
    const getGpsStatusBadge = () => {
        if (gpsTrackingActive) {
            return (
                <span style={{ color: "#34d399", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#34d399", animation: "pulse 1.5s infinite" }}></span>
                    ● Live GPS Broadcasting
                </span>
            );
        }
        if (gps?.recorded_at) {
            const mins = gps.minutes_ago || 0;
            if (mins <= 2) {
                return <span style={{ color: "#94a3b8" }}>Last updated {mins === 0 ? "just now" : `${mins}m ago`}</span>;
            }
            return <span style={{ color: "#f87171" }}>⚠️ GPS signal may be outdated ({mins}m ago)</span>;
        }
        return <span style={{ color: "#94a3b8" }}>GPS not broadcasting</span>;
    };

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#0f172a", color: "#f8fafc", fontFamily: "'Inter', sans-serif" }}>
            <Navbar user={user} onLogout={onLogout} />

            <main style={{ padding: "16px", maxWidth: "1350px", margin: "0 auto" }}>
                {/* TOP HEADER BAR */}
                <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "12px",
                    marginBottom: "16px",
                    backgroundColor: "#1e293b",
                    padding: "14px 20px",
                    borderRadius: "12px",
                    border: "1px solid #334155"
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <div style={{ fontSize: "32px", backgroundColor: "#0f172a", padding: "8px", borderRadius: "10px", border: "1px solid #334155" }}>
                            🚛
                        </div>
                        <div>
                            <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#94a3b8", fontWeight: "700", letterSpacing: "0.5px" }}>
                                Driver Portal • Checkpoint Verification
                            </div>
                            <div style={{ fontSize: "20px", fontWeight: "800", color: "#34d399", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span>{vehicle ? vehicle.vehicle_number : "No Vehicle Assigned"}</span>
                                <span style={{ fontSize: "13px", fontWeight: "800", backgroundColor: "#065f46", color: "#6ee7b7", padding: "3px 10px", borderRadius: "6px", border: "1px solid #059669" }}>
                                    Permanent Assigned Area: {vehicle?.permanent_ward || "Not Assigned"}
                                </span>
                                <span style={{ fontSize: "12px", fontWeight: "800", backgroundColor: "#1e3a8a", color: "#93c5fd", padding: "3px 8px", borderRadius: "6px" }}>
                                    Status: {vehicle?.status || "ACTIVE"}
                                </span>
                                {vehicle?.temporary_ward && (
                                    <span style={{ fontSize: "12px", fontWeight: "800", backgroundColor: "#78350f", color: "#fde68a", padding: "3px 8px", borderRadius: "6px" }}>
                                        ⚡ Covering Today: {vehicle.temporary_ward}
                                    </span>
                                )}
                                <span style={{ fontSize: "13px", fontWeight: "600", color: "#94a3b8" }}>
                                    • Driver: {user?.name || "Ramesh Kumar"}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                        {/* GPS Freshness Indicator */}
                        <div style={{ fontSize: "12px", padding: "6px 12px", backgroundColor: "#0f172a", borderRadius: "8px", border: "1px solid #334155" }}>
                            {getGpsStatusBadge()}
                        </div>

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
                                backgroundColor: gpsTrackingActive ? "#059669" : "#2563eb",
                                color: "white",
                                border: "none",
                                padding: "9px 16px",
                                borderRadius: "8px",
                                fontWeight: "700",
                                fontSize: "13px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                boxShadow: "0 2px 6px rgba(0,0,0,0.3)"
                            }}
                        >
                            <span>{gpsTrackingActive ? "● Broadcasting" : "🚀 Start GPS"}</span>
                        </button>
                    </div>
                </div>

                {error && (
                    <div style={{ backgroundColor: "#7f1d1d", color: "#fecaca", padding: "12px 16px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px", fontWeight: "600" }}>
                        ⚠️ {error}
                    </div>
                )}

                {/* CURRENT COLLECTION ZONE SECTION */}
                {nextStop ? (
                    <div style={{
                        backgroundColor: "#1e293b",
                        border: isInsideGeofence ? "2px solid #10b981" : "2px solid #0284c7",
                        borderRadius: "16px",
                        padding: "20px 24px",
                        marginBottom: "20px",
                        boxShadow: isInsideGeofence ? "0 4px 20px rgba(16,185,129,0.2)" : "0 4px 15px rgba(2,132,199,0.15)"
                    }}>
                        {/* Zone Header Bar */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", borderBottom: "1px solid #334155", paddingBottom: "16px", marginBottom: "18px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                                <div style={{
                                    width: "48px",
                                    height: "48px",
                                    borderRadius: "12px",
                                    backgroundColor: isInsideGeofence ? "#10b981" : "#0284c7",
                                    color: isInsideGeofence ? "#064e3b" : "#ffffff",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontWeight: "900",
                                    fontSize: "20px"
                                }}>
                                    #{nextStop.sequence}
                                </div>
                                <div>
                                    <div style={{ fontSize: "11px", color: isInsideGeofence ? "#34d399" : "#38bdf8", textTransform: "uppercase", fontWeight: "800", letterSpacing: "0.5px" }}>
                                        {isInsideGeofence ? "🟢 GEOFENCE REACHED • COLLECTION ZONE ACTIVE" : `CURRENT COLLECTION ZONE • STOP ${nextStop.sequence} OF ${summary.total_stops}`}
                                    </div>
                                    <div style={{ fontSize: "22px", fontWeight: "900", color: "#ffffff", marginTop: "2px" }}>
                                        📍 {nextStopCp?.name}
                                    </div>
                                    <div style={{ fontSize: "13px", color: "#94a3b8", marginTop: "2px" }}>
                                        {nextStopCp?.ward} • {nextStopCp?.address} • Scheduled: {nextStopCp?.scheduled_time || "09:00 AM"}
                                    </div>
                                </div>
                            </div>

                            {/* Distance & Geofence Status */}
                            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                                <div style={{ textAlign: "right" }}>
                                    <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "700", textTransform: "uppercase" }}>
                                        Distance to Zone
                                    </div>
                                    <div style={{ fontSize: "20px", fontWeight: "900", color: isInsideGeofence ? "#34d399" : "#38bdf8" }}>
                                        {formatDistance(distanceToNextMeters)}
                                    </div>
                                    <div style={{ fontSize: "11px", color: isInsideGeofence ? "#34d399" : "#94a3b8", fontWeight: "600" }}>
                                        {isInsideGeofence ? "✓ Inside 100m Geofence" : `Geofence: ${geofenceRadius}m`}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 4-SECTION COMPACT GRID AS REQUESTED */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "18px" }}>
                            
                            {/* CARD 1: CHECKPOINT PROGRESS & LIST */}
                            <div style={{ backgroundColor: "#0f172a", borderRadius: "12px", padding: "16px", border: "1px solid #334155" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#94a3b8", textTransform: "uppercase" }}>
                                        Checkpoint Progress
                                    </span>
                                    <span style={{
                                        fontSize: "14px",
                                        fontWeight: "900",
                                        color: allScannersScanned ? "#34d399" : "#38bdf8"
                                    }}>
                                        {scannedCount} / {totalScanners}
                                    </span>
                                </div>

                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {(nextStop.checkpoints || []).map((cpItem, idx) => (
                                        <div
                                            key={cpItem.id || idx}
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                backgroundColor: cpItem.is_scanned ? "#064e3b33" : "#1e293b",
                                                padding: "8px 12px",
                                                borderRadius: "8px",
                                                border: "1px solid",
                                                borderColor: cpItem.is_scanned ? "#059669" : "#334155"
                                            }}
                                        >
                                            <div style={{ fontSize: "13px", fontWeight: "700", color: cpItem.is_scanned ? "#34d399" : "#f8fafc" }}>
                                                Scanner {cpItem.sequence || idx + 1}: {cpItem.is_scanned ? "✅ Verified" : "⏳ Pending"}
                                            </div>
                                            {cpItem.scanned_at && (
                                                <span style={{ fontSize: "11px", color: "#a7f3d0" }}>
                                                    {new Date(cpItem.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* CARD 2: COLLECTION TIME & GEOFENCE DWELL */}
                            <div style={{ backgroundColor: "#0f172a", borderRadius: "12px", padding: "16px", border: "1px solid #334155" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#94a3b8", textTransform: "uppercase" }}>
                                        Collection Time
                                    </span>
                                    <span style={{
                                        fontSize: "11px",
                                        fontWeight: "800",
                                        padding: "2px 8px",
                                        borderRadius: "6px",
                                        backgroundColor: isDwellMet ? "#065f46" : nextStop.dwell_start_time ? "#0c4a6e" : "#334155",
                                        color: isDwellMet ? "#6ee7b7" : nextStop.dwell_start_time ? "#38bdf8" : "#94a3b8"
                                    }}>
                                        {isDwellMet ? "✓ Duration Met" : nextStop.dwell_start_time ? "Active" : "Pending"}
                                    </span>
                                </div>

                                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", margin: "10px 0" }}>
                                    <span style={{ fontSize: "36px", fontWeight: "900", fontFamily: "monospace", color: isDwellMet ? "#34d399" : "#38bdf8" }}>
                                        {formatSeconds(liveDwellSeconds)}
                                    </span>
                                    <span style={{ fontSize: "16px", fontWeight: "700", color: "#64748b" }}>
                                        / {formatSeconds(minCollectionSec)}
                                    </span>
                                </div>

                                <div style={{ width: "100%", height: "8px", backgroundColor: "#1e293b", borderRadius: "4px", overflow: "hidden", marginBottom: "8px" }}>
                                    <div style={{
                                        width: `${Math.min(100, Math.round((liveDwellSeconds / minCollectionSec) * 100))}%`,
                                        height: "100%",
                                        backgroundColor: isDwellMet ? "#10b981" : "#0284c7",
                                        transition: "width 0.4s ease"
                                    }} />
                                </div>

                                <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                                    {nextStop.verification_status === "DWELL_RESET" ? (
                                        <span style={{ color: "#f87171", fontWeight: "700" }}>
                                            ⚠️ Timer reset because vehicle left 100m geofence early.
                                        </span>
                                    ) : (
                                        <span>Vehicle must remain inside geofence for min duration.</span>
                                    )}
                                </div>
                            </div>

                            {/* CARD 3: PROGRESS VISUALIZATION (Vertical Stepper) */}
                            <div style={{ backgroundColor: "#0f172a", borderRadius: "12px", padding: "16px", border: "1px solid #334155" }}>
                                <div style={{ fontSize: "12px", fontWeight: "700", color: "#94a3b8", textTransform: "uppercase", marginBottom: "10px" }}>
                                    Progress Visualization
                                </div>

                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                    {(nextStop.checkpoints || []).map((cpItem, idx, arr) => (
                                        <div key={cpItem.id || idx}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                <span style={{
                                                    fontSize: "14px",
                                                    color: cpItem.is_scanned ? "#34d399" : "#64748b",
                                                    fontWeight: "800"
                                                }}>
                                                    {cpItem.is_scanned ? "●" : "○"}
                                                </span>
                                                <span style={{
                                                    fontSize: "13px",
                                                    fontWeight: "700",
                                                    color: cpItem.is_scanned ? "#f8fafc" : "#94a3b8"
                                                }}>
                                                    Scanner {cpItem.sequence || idx + 1} {cpItem.is_scanned && "✓"}
                                                </span>
                                            </div>
                                            {idx < arr.length - 1 && (
                                                <div style={{
                                                    marginLeft: "4px",
                                                    borderLeft: "2px solid",
                                                    borderColor: cpItem.is_scanned && arr[idx + 1].is_scanned ? "#10b981" : "#334155",
                                                    height: "12px",
                                                    margin: "2px 0 2px 4px"
                                                }} />
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px solid #1e293b", fontSize: "12px", fontWeight: "800", color: allScannersScanned ? "#34d399" : "#38bdf8" }}>
                                    {allScannersScanned
                                        ? "✅ COLLECTION ZONE COMPLETED"
                                        : `${scannedCount} / ${totalScanners} Checkpoints Verified`}
                                </div>
                            </div>
                        </div>

                        {/* NEXT CHECKPOINT & SCANNER BUTTON BANNER */}
                        <div style={{
                            backgroundColor: "#0f172a",
                            borderRadius: "14px",
                            padding: "16px 20px",
                            border: "1px solid #334155",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "14px"
                        }}>
                            <div>
                                {allScannersScanned ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                        <span style={{ fontSize: "28px" }}>🎉</span>
                                        <div>
                                            <div style={{ fontSize: "16px", fontWeight: "900", color: "#34d399" }}>
                                                All {totalScanners} Checkpoints Verified
                                            </div>
                                            <div style={{ fontSize: "12px", color: "#a7f3d0" }}>
                                                Collection zone successfully serviced and validated with GPS proof.
                                            </div>
                                        </div>
                                    </div>
                                ) : nextPendingCheckpoint ? (
                                    <div>
                                        <div style={{ fontSize: "11px", color: "#38bdf8", fontWeight: "800", textTransform: "uppercase" }}>
                                            NEXT CHECKPOINT
                                        </div>
                                        <div style={{ fontSize: "18px", fontWeight: "900", color: "#ffffff", marginTop: "2px" }}>
                                            🏷️ {nextPendingCheckpoint.name} ({nextPendingCheckpoint.scanner_code})
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            {/* The [ SCAN CHECKPOINT ] Button */}
                            <div style={{ display: "flex", gap: "10px" }}>
                                <button
                                    onClick={() => setMissModalStopId(nextStop.id)}
                                    disabled={actionLoading}
                                    style={{
                                        backgroundColor: "transparent",
                                        color: "#f87171",
                                        border: "1px solid #7f1d1d",
                                        padding: "10px 16px",
                                        borderRadius: "8px",
                                        fontWeight: "700",
                                        fontSize: "13px",
                                        cursor: "pointer"
                                    }}
                                >
                                    ✕ Report Missed
                                </button>

                                {allScannersScanned ? (
                                    <button
                                        disabled
                                        style={{
                                            backgroundColor: "#065f46",
                                            color: "#6ee7b7",
                                            border: "1px solid #059669",
                                            padding: "12px 24px",
                                            borderRadius: "10px",
                                            fontWeight: "900",
                                            fontSize: "14px",
                                            cursor: "default"
                                        }}
                                    >
                                        ✓ ZONE COMPLETED
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => setQrScannerOpen(true)}
                                        disabled={!isInsideGeofence || actionLoading}
                                        style={{
                                            background: isInsideGeofence
                                                ? "linear-gradient(135deg, #0284c7, #0369a1)"
                                                : "#334155",
                                            color: isInsideGeofence ? "#ffffff" : "#94a3b8",
                                            border: "none",
                                            padding: "12px 26px",
                                            borderRadius: "10px",
                                            fontWeight: "900",
                                            fontSize: "14px",
                                            cursor: isInsideGeofence ? "pointer" : "not-allowed",
                                            boxShadow: isInsideGeofence ? "0 4px 15px rgba(2,132,199,0.4)" : "none",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            transition: "all 0.2s ease"
                                        }}
                                    >
                                        <span>📷</span>
                                        <span>{isInsideGeofence ? "SCAN CHECKPOINT" : "Reach Collection Zone First"}</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : stops.length > 0 ? (
                    <div style={{ backgroundColor: "#1e293b", padding: "18px 24px", borderRadius: "14px", border: "1px solid #334155", marginBottom: "20px", color: "#34d399", fontWeight: "800", fontSize: "16px", display: "flex", alignItems: "center", gap: "10px" }}>
                        <span>🎉</span>
                        <span>All collection zones for this route have been completed and verified!</span>
                    </div>
                ) : null}

                {/* MAIN NAVIGATION GRID: MAP & TURN-BY-TURN LIST */}
                <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "16px", alignItems: "start" }}>

                    {/* INTERACTIVE NAVIGATION MAP */}
                    <div style={{ backgroundColor: "#1e293b", borderRadius: "14px", border: "1px solid #334155", padding: "16px", position: "relative" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "18px" }}>🗺️</span>
                                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#f8fafc" }}>
                                    Live Navigation Map
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
                                        padding: "7px 14px",
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
                                        padding: "7px 14px",
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
                        <div style={{ height: "480px", borderRadius: "10px", overflow: "hidden", border: "1px solid #334155" }}>
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
                                                Ward: <strong>{vehicle?.permanent_ward || "Assigned"}</strong><br />
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
                                                    Checkpoints: {stop.progress_text || `${stop.scanned_count || 0}/${stop.total_scanners || 3}`}<br />
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
                        <div style={{ display: "flex", gap: "16px", marginTop: "12px", fontSize: "12px", color: "#94a3b8", justifyContent: "center", flexWrap: "wrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#0284c7", display: "inline-block" }}></span>
                                <span>⭐ Current Zone</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ width: "12px", height: "12px", borderRadius: "50%", backgroundColor: "#f59e0b", display: "inline-block" }}></span>
                                <span>🟡 Pending Zone</span>
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
                                    Ward Collection Progress
                                </span>
                                <span style={{ fontSize: "14px", fontWeight: "800", color: "#34d399" }}>
                                    {summary.completed_count} / {summary.total_stops} zones ({summary.progress_percent}%)
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

                        {/* ORDERED TURN-BY-TURN ZONE LIST */}
                        <div style={{ backgroundColor: "#1e293b", borderRadius: "14px", border: "1px solid #334155", padding: "18px", maxHeight: "380px", overflowY: "auto" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "800", color: "#f8fafc", textTransform: "uppercase" }}>
                                    Zone Route Sequence (1 → {stops.length})
                                </h4>
                                <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                                    Total: {route?.total_distance_km || "0.00"} km
                                </span>
                            </div>

                            {stops.length === 0 ? (
                                <div style={{ textAlign: "center", padding: "30px", color: "#94a3b8", fontSize: "13px" }}>
                                    No collection zones assigned for {selectedDate}.
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
                                                            backgroundColor: isCompleted ? "#16a34a" : isMissed ? "#dc2626" : isNext ? "#0284c7" : "#f59e0b",
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

                                                    {/* Verification Metrics Tag */}
                                                    <div style={{ display: "flex", gap: "8px", marginTop: "4px", fontSize: "11px" }}>
                                                        <span style={{ color: stop.scanned_count >= stop.total_scanners ? "#4ade80" : "#fbbf24", fontWeight: "700" }}>
                                                            Checkpoints: {stop.progress_text || `${stop.scanned_count || 0}/${stop.total_scanners || 3}`}
                                                        </span>
                                                        {isCompleted && (
                                                            <span style={{ color: "#4ade80", fontWeight: "600" }}>
                                                                • Verified at {stop.actual_arrival ? new Date(stop.actual_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Done"}
                                                            </span>
                                                        )}
                                                        {isMissed && (
                                                            <span style={{ color: "#f87171", fontWeight: "600" }}>
                                                                • ❌ {stop.miss_reason || "Missed"}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Action buttons for pending stop */}
                                                {stop.status === "PENDING" && !isNext && (
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                                        <button
                                                            onClick={() => setMissModalStopId(stop.id)}
                                                            disabled={actionLoading}
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

            {/* In-Dashboard Camera QR Scanner Modal */}
            <CheckpointQRScannerModal
                isOpen={qrScannerOpen}
                onClose={() => setQrScannerOpen(false)}
                nextStop={nextStop}
                onScanSuccess={async () => {
                    await fetchDriverRoute(selectedDate);
                }}
                vehiclePosition={vehiclePosition}
                driverId={user.id}
                vehicleId={vehicle?.id}
                api={api}
            />

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
                            Report Missed Collection Zone
                        </h3>
                        <p style={{ fontSize: "13px", color: "#cbd5e1" }}>
                            Please specify a reason why this collection zone could not be serviced.
                        </p>
                        <select
                            value={missReason}
                            onChange={(e) => setMissReason(e.target.value)}
                            style={{
                                width: "100%",
                                padding: "10px",
                                borderRadius: "8px",
                                backgroundColor: "#0f172a",
                                color: "#f8fafc",
                                border: "1px solid #334155",
                                marginBottom: "20px",
                                fontSize: "14px"
                            }}
                        >
                            <option value="Heavy Traffic">Heavy Traffic</option>
                            <option value="Road Block / Construction">Road Block / Construction</option>
                            <option value="Vehicle Breakdown">Vehicle Breakdown</option>
                            <option value="Inaccessible Road / Narrow Lane">Inaccessible Road / Narrow Lane</option>
                            <option value="Time Constraint">Time Constraint</option>
                        </select>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                            <button
                                onClick={() => setMissModalStopId(null)}
                                style={{
                                    padding: "8px 16px",
                                    backgroundColor: "transparent",
                                    color: "#cbd5e1",
                                    border: "1px solid #334155",
                                    borderRadius: "6px",
                                    cursor: "pointer"
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmMiss}
                                style={{
                                    padding: "8px 16px",
                                    backgroundColor: "#dc2626",
                                    color: "white",
                                    border: "none",
                                    borderRadius: "6px",
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