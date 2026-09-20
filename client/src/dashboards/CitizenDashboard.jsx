import React, { useState, useEffect, useRef } from "react";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import api from "../services/api";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

// Map Controller for custom map action buttons ("My Location", "Find Vehicle", "Fit View")
function CitizenMapController({ citizenPos, pointPos, vehiclePos, actionTrigger }) {
    const map = useMap();

    useEffect(() => {
        if (!actionTrigger) return;

        if (actionTrigger.type === "MY_LOCATION" && citizenPos) {
            map.flyTo([citizenPos.latitude, citizenPos.longitude], 16, { animate: true, duration: 1 });
        } else if (actionTrigger.type === "FIND_VEHICLE" && vehiclePos) {
            map.flyTo([vehiclePos.latitude, vehiclePos.longitude], 16, { animate: true, duration: 1 });
        } else if (actionTrigger.type === "FIT_VIEW") {
            const points = [];
            if (citizenPos) points.push([citizenPos.latitude, citizenPos.longitude]);
            if (pointPos) points.push([pointPos.latitude, pointPos.longitude]);
            if (vehiclePos) points.push([vehiclePos.latitude, vehiclePos.longitude]);

            if (points.length > 0) {
                const bounds = L.latLngBounds(points);
                map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
            }
        }
    }, [actionTrigger, citizenPos, pointPos, vehiclePos, map]);

    // Initial bounding on data load
    useEffect(() => {
        const points = [];
        if (citizenPos) points.push([citizenPos.latitude, citizenPos.longitude]);
        if (pointPos) points.push([pointPos.latitude, pointPos.longitude]);
        if (vehiclePos) points.push([vehiclePos.latitude, vehiclePos.longitude]);

        if (points.length > 0) {
            const bounds = L.latLngBounds(points);
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
        }
    }, [citizenPos, pointPos, vehiclePos, map]);

    return null;
}

// Custom markers for Citizen View
const citizenIcon = L.divIcon({
    className: "custom-citizen-marker",
    html: `<div style="
        background-color: #2563eb;
        color: white;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        border: 3px solid white;
        box-shadow: 0 3px 8px rgba(0,0,0,0.4);
    ">📍</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16]
});

const pointIcon = L.divIcon({
    className: "custom-point-marker",
    html: `<div style="
        background-color: #047857;
        color: white;
        border-radius: 50%;
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        border: 3px solid white;
        box-shadow: 0 3px 8px rgba(0,0,0,0.4);
    ">🗑️</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17]
});

const vehicleIcon = L.divIcon({
    className: "custom-citizen-vehicle-marker",
    html: `<div style="
        background: linear-gradient(135deg, #d97706, #b45309);
        color: white;
        border-radius: 20px;
        padding: 5px 12px;
        font-weight: 800;
        font-size: 12px;
        border: 2px solid white;
        box-shadow: 0 4px 10px rgba(0,0,0,0.35);
        display: flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
    ">
        <span>🚛</span>
        <span>Collection Vehicle</span>
    </div>`,
    iconSize: [160, 32],
    iconAnchor: [80, 16],
    popupAnchor: [0, -16]
});

function CitizenDashboard({ user, onLogout }) {
    const [activeTab, setActiveTab] = useState("track-vehicle");
    const [points, setPoints] = useState([]);
    const [myComplaints, setMyComplaints] = useState([]);
    const [complaintCategory, setComplaintCategory] = useState("Missed Collection");
    const [complaintDesc, setComplaintDesc] = useState("");
    const [selectedPointId, setSelectedPointId] = useState("");
    const [complaintMsg, setComplaintMsg] = useState("");

    // Location & Tracking State
    const [locationMode, setLocationMode] = useState(null); // 'gps' | 'manual' | null
    const [citizenCoords, setCitizenCoords] = useState(null);
    const [manualPointId, setManualPointId] = useState("");
    const [trackingDate, setTrackingDate] = useState("2026-09-20");
    const [trackingData, setTrackingData] = useState(null);
    const [trackingLoading, setTrackingLoading] = useState(false);
    const [trackingError, setTrackingError] = useState("");
    const [geoPermissionError, setGeoPermissionError] = useState("");
    const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

    // Map Action Trigger
    const [mapAction, setMapAction] = useState(null);

    const pollingIntervalRef = useRef(null);

    const fetchCitizenData = async () => {
        try {
            const pRes = await api.get("/collection-points");
            setPoints(pRes.data || []);

            const cRes = await api.get(`/complaints/citizen/${user.id}`);
            setMyComplaints(cRes.data || []);
        } catch (err) {
            console.error("Citizen data fetch error:", err);
        }
    };

    useEffect(() => {
        fetchCitizenData();
    }, [user.id]);

    // Fetch live collection status based on citizen location or selected collection point
    const fetchCollectionStatus = async (overrideCoords = citizenCoords, overridePointId = manualPointId, overrideDate = trackingDate) => {
        if (!overrideCoords && !overridePointId) return;

        setTrackingLoading(true);
        setTrackingError("");

        try {
            const params = new URLSearchParams();
            if (overrideDate) params.append("date", overrideDate);

            if (overridePointId) {
                params.append("collection_point_id", overridePointId);
                if (overrideCoords) {
                    params.append("latitude", overrideCoords.latitude);
                    params.append("longitude", overrideCoords.longitude);
                }
            } else if (overrideCoords) {
                params.append("latitude", overrideCoords.latitude);
                params.append("longitude", overrideCoords.longitude);
            }

            const res = await api.get(`/citizen/collection-status?${params.toString()}`);
            setTrackingData(res.data);
            setLastRefreshedAt(new Date());

            if (!res.data.found) {
                setTrackingError(res.data.message || "No collection point found near your location.");
            }
        } catch (err) {
            console.error("Failed to fetch collection status:", err);
            setTrackingError(err.response?.data?.message || "Failed to load waste collection status.");
            setTrackingData(null);
        } finally {
            setTrackingLoading(false);
        }
    };

    // Handle "Use My Location"
    const handleUseMyLocation = () => {
        setGeoPermissionError("");
        setTrackingError("");
        if (!navigator.geolocation) {
            setGeoPermissionError("Location permission is required to find your nearby collection point. Please select your area manually.");
            return;
        }

        setTrackingLoading(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const coords = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                setCitizenCoords(coords);
                setManualPointId("");
                setLocationMode("gps");
                fetchCollectionStatus(coords, "", trackingDate);
            },
            (err) => {
                console.error("Geolocation error:", err);
                setTrackingLoading(false);
                setGeoPermissionError("Location permission is required to find your nearby collection point. Please select your area manually.");
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
        );
    };

    // Handle "Select Area"
    const handleSelectManualPoint = (pointId) => {
        setManualPointId(pointId);
        setLocationMode("manual");
        setGeoPermissionError("");
        setTrackingError("");

        const pt = points.find(p => p.id.toString() === pointId.toString());
        if (pt) {
            const coords = {
                latitude: Number(pt.latitude),
                longitude: Number(pt.longitude)
            };
            setCitizenCoords(coords);
            fetchCollectionStatus(coords, pointId, trackingDate);
        } else {
            fetchCollectionStatus(null, pointId, trackingDate);
        }
    };

    // Periodic auto-refresh every 20 seconds
    useEffect(() => {
        if (locationMode && (citizenCoords || manualPointId)) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = setInterval(() => {
                fetchCollectionStatus(citizenCoords, manualPointId, trackingDate);
            }, 20000);
        }
        return () => {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        };
    }, [locationMode, citizenCoords, manualPointId, trackingDate]);

    const handleRaiseComplaint = async (e) => {
        e.preventDefault();
        try {
            await api.post("/complaints", {
                citizen_id: user.id,
                collection_point_id: selectedPointId || null,
                category: complaintCategory,
                description: complaintDesc,
                latitude: 12.9716,
                longitude: 77.5946
            });
            setComplaintMsg("Complaint submitted successfully!");
            setComplaintDesc("");
            fetchCitizenData();
            setTimeout(() => {
                setComplaintMsg("");
                setActiveTab("my-complaints");
            }, 1200);
        } catch (err) {
            setComplaintMsg(err.response?.data?.message || "Failed to submit complaint.");
        }
    };

    const renderCitizenContent = () => {
        switch (activeTab) {
            case "raise-complaint":
                return (
                    <div style={{ padding: "24px", maxWidth: "600px", margin: "0 auto" }}>
                        <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: "0 0 6px 0" }}>Raise a Complaint</h1>
                        <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 20px 0" }}>Report missed collection, waste leakage, or overflowing bins</p>

                        <div style={{ backgroundColor: "white", padding: "28px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                            <form onSubmit={handleRaiseComplaint}>
                                <div style={{ marginBottom: "16px" }}>
                                    <label style={{ display: "block", fontSize: "14px", fontWeight: "600", marginBottom: "6px" }}>Complaint Type</label>
                                    <select
                                        value={complaintCategory}
                                        onChange={(e) => setComplaintCategory(e.target.value)}
                                        style={{ width: "100%", padding: "10px 14px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                                    >
                                        <option value="Missed Collection">Missed Collection</option>
                                        <option value="Waste Leakage">Waste Leakage</option>
                                        <option value="Overflowing Waste">Overflowing Waste</option>
                                        <option value="Other">Other</option>
                                    </select>
                                </div>

                                <div style={{ marginBottom: "16px" }}>
                                    <label style={{ display: "block", fontSize: "14px", fontWeight: "600", marginBottom: "6px" }}>Nearest Collection Point</label>
                                    <select
                                        value={selectedPointId}
                                        onChange={(e) => setSelectedPointId(e.target.value)}
                                        style={{ width: "100%", padding: "10px 14px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                                    >
                                        <option value="">Select Location</option>
                                        {points.map(p => (
                                            <option key={p.id} value={p.id}>{p.name} ({p.ward})</option>
                                        ))}
                                    </select>
                                </div>

                                <div style={{ marginBottom: "20px" }}>
                                    <label style={{ display: "block", fontSize: "14px", fontWeight: "600", marginBottom: "6px" }}>Description</label>
                                    <textarea
                                        rows="4"
                                        placeholder="Describe the issue in detail..."
                                        value={complaintDesc}
                                        onChange={(e) => setComplaintDesc(e.target.value)}
                                        required
                                        style={{ width: "100%", padding: "10px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                                    />
                                </div>

                                {complaintMsg && (
                                    <div style={{ marginBottom: "16px", color: complaintMsg.includes("success") ? "#047857" : "#dc2626", fontWeight: "600" }}>
                                        {complaintMsg}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    style={{
                                        width: "100%",
                                        backgroundColor: "#047857",
                                        color: "white",
                                        padding: "12px",
                                        borderRadius: "6px",
                                        border: "none",
                                        fontWeight: "600",
                                        cursor: "pointer",
                                        fontSize: "15px"
                                    }}
                                >
                                    Submit Complaint
                                </button>
                            </form>
                        </div>
                    </div>
                );

            case "my-complaints":
                return (
                    <div style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                            <div>
                                <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>My Complaints</h1>
                                <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>Track status of your submitted complaints</p>
                            </div>
                            <button
                                onClick={() => setActiveTab("raise-complaint")}
                                style={{
                                    backgroundColor: "#047857",
                                    color: "white",
                                    padding: "10px 18px",
                                    borderRadius: "8px",
                                    border: "none",
                                    fontWeight: "600",
                                    cursor: "pointer"
                                }}
                            >
                                + Raise Complaint
                            </button>
                        </div>

                        <div style={{ backgroundColor: "white", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
                                <thead>
                                    <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                                        <th style={{ padding: "14px 20px" }}>ID</th>
                                        <th style={{ padding: "14px 20px" }}>Type</th>
                                        <th style={{ padding: "14px 20px" }}>Location</th>
                                        <th style={{ padding: "14px 20px" }}>Date</th>
                                        <th style={{ padding: "14px 20px" }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {myComplaints.length === 0 ? (
                                        <tr><td colSpan="5" style={{ padding: "20px", textAlign: "center", color: "#64748b" }}>No complaints submitted yet</td></tr>
                                    ) : (
                                        myComplaints.map((c) => (
                                            <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                                <td style={{ padding: "14px 20px", fontWeight: "600" }}>C00{c.id}</td>
                                                <td style={{ padding: "14px 20px", color: "#047857", fontWeight: "600" }}>{c.category}</td>
                                                <td style={{ padding: "14px 20px", color: "#334155" }}>{c.location || "Green Park"}</td>
                                                <td style={{ padding: "14px 20px", color: "#64748b" }}>{new Date(c.created_at).toLocaleDateString()}</td>
                                                <td style={{ padding: "14px 20px" }}>
                                                    <span style={{
                                                        padding: "4px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "600",
                                                        backgroundColor: c.status === "RESOLVED" ? "#dcfce7" : c.status === "IN_PROGRESS" ? "#fef3c7" : "#fee2e2",
                                                        color: c.status === "RESOLVED" ? "#15803d" : c.status === "IN_PROGRESS" ? "#b45309" : "#b91c1c"
                                                    }}>
                                                        {c.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );

            case "track-vehicle":
            default:
                return renderCitizenTracking();
        }
    };

    // Render Location-Based Citizen Tracking Experience
    const renderCitizenTracking = () => {
        const pointData = trackingData?.collectionPoint || trackingData?.collection_point;
        const vehicleData = trackingData?.vehicle;
        const driverData = trackingData?.driver;
        const collectionData = trackingData?.collection;
        const trackingGps = trackingData?.tracking || trackingData?.gps;
        const delayData = trackingData?.delay;

        // Leaflet positions
        const citizenPos = citizenCoords ? { latitude: citizenCoords.latitude, longitude: citizenCoords.longitude } : null;
        const pointPos = pointData ? { latitude: pointData.latitude, longitude: pointData.longitude } : null;
        const vehiclePos = trackingGps && trackingGps.latitude && trackingGps.longitude ? { latitude: trackingGps.latitude, longitude: trackingGps.longitude } : null;

        const defaultCenter = citizenPos
            ? [citizenPos.latitude, citizenPos.longitude]
            : pointPos
                ? [pointPos.latitude, pointPos.longitude]
                : [12.9716, 77.5946];

        // Tracking line between assigned vehicle and collection point
        const lineCoords = (vehiclePos && pointPos)
            ? [[vehiclePos.latitude, vehiclePos.longitude], [pointPos.latitude, pointPos.longitude]]
            : [];

        // GPS Staleness string
        const getGpsStatusText = () => {
            if (!trackingGps || trackingGps.latitude === null || trackingGps.latitude === undefined) {
                return "Vehicle location unavailable.";
            }
            if (trackingGps.minutesAgo === null || trackingGps.minutesAgo === undefined) {
                return "Live coordinates available.";
            }
            if (trackingGps.minutesAgo === 0) {
                return "Live Location • Last updated: just now";
            }
            if (trackingGps.minutesAgo <= 3) {
                return `Last updated: ${trackingGps.minutesAgo} minute${trackingGps.minutesAgo > 1 ? "s" : ""} ago`;
            }
            return `⚠️ Location last updated ${trackingGps.minutesAgo} minutes ago`;
        };

        return (
            <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
                {/* Header Bar */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
                    <div>
                        <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                            Citizen Dashboard • Waste Collection Tracking
                        </h1>
                        <p style={{ fontSize: "14px", color: "#64748b", margin: "2px 0 0 0" }}>
                            Track the waste collection vehicle assigned to your neighborhood collection point
                        </p>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", backgroundColor: "white", padding: "6px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                        <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>📅 Operation Date:</span>
                        <input
                            type="date"
                            value={trackingDate}
                            onChange={(e) => {
                                setTrackingDate(e.target.value);
                                if (citizenCoords || manualPointId) {
                                    fetchCollectionStatus(citizenCoords, manualPointId, e.target.value);
                                }
                            }}
                            style={{ border: "1px solid #cbd5e1", borderRadius: "6px", padding: "4px 8px", fontSize: "12px", fontWeight: "600" }}
                        />
                    </div>
                </div>

                {/* LOCATION SELECTION BAR */}
                <div style={{
                    backgroundColor: "#ffffff",
                    padding: "16px 20px",
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    marginBottom: "20px",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                }}>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: "#475569", textTransform: "uppercase", marginBottom: "10px", letterSpacing: "0.5px" }}>
                        📍 Set Your Neighborhood Location
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                        {/* Option 1: Use My Location */}
                        <button
                            onClick={handleUseMyLocation}
                            disabled={trackingLoading}
                            style={{
                                backgroundColor: locationMode === "gps" ? "#047857" : "#0f766e",
                                color: "white",
                                padding: "9px 16px",
                                borderRadius: "8px",
                                border: "none",
                                fontWeight: "700",
                                fontSize: "13px",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: "6px"
                            }}
                        >
                            <span>🎯</span>
                            <span>{locationMode === "gps" ? "Location Active (GPS)" : "Use My Location"}</span>
                        </button>

                        <span style={{ fontSize: "13px", color: "#94a3b8", fontWeight: "700" }}>OR</span>

                        {/* Option 2: Select Area Dropdown */}
                        <div style={{ flex: 1, minWidth: "260px" }}>
                            <select
                                value={manualPointId}
                                onChange={(e) => handleSelectManualPoint(e.target.value)}
                                style={{
                                    width: "100%",
                                    padding: "9px 14px",
                                    borderRadius: "8px",
                                    border: "1px solid #cbd5e1",
                                    fontSize: "13px",
                                    fontWeight: "600",
                                    color: "#0f172a",
                                    backgroundColor: locationMode === "manual" ? "#f0fdf4" : "#ffffff"
                                }}
                            >
                                <option value="">Select your area / nearest collection point...</option>
                                {points.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        📍 {p.name} ({p.ward} — {p.address})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Refresh Button */}
                        {locationMode && (
                            <button
                                onClick={() => fetchCollectionStatus(citizenCoords, manualPointId, trackingDate)}
                                disabled={trackingLoading}
                                style={{
                                    backgroundColor: "#f8fafc",
                                    color: "#047857",
                                    border: "1px solid #cbd5e1",
                                    padding: "9px 16px",
                                    borderRadius: "8px",
                                    fontWeight: "700",
                                    fontSize: "13px",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px"
                                }}
                            >
                                <span>🔄</span>
                                <span>{trackingLoading ? "Updating..." : "Refresh Vehicle Status"}</span>
                            </button>
                        )}
                    </div>

                    {/* Geolocation Permission Warning */}
                    {geoPermissionError && (
                        <div style={{ marginTop: "10px", padding: "10px 14px", backgroundColor: "#fffbeb", borderRadius: "8px", border: "1px solid #fef08a", color: "#92400e", fontSize: "13px", fontWeight: "600" }}>
                            ⚠️ {geoPermissionError}
                        </div>
                    )}
                </div>

                {/* PROMPT STATE: Before selecting location */}
                {!locationMode && (
                    <div style={{
                        backgroundColor: "#ffffff",
                        padding: "40px 24px",
                        borderRadius: "12px",
                        border: "1px dashed #cbd5e1",
                        textAlign: "center",
                        color: "#64748b"
                    }}>
                        <div style={{ fontSize: "44px", marginBottom: "10px" }}>📍</div>
                        <h2 style={{ fontSize: "20px", fontWeight: "800", color: "#0f172a", margin: "0 0 8px 0" }}>
                            Locate Your Assigned Waste Collection Vehicle
                        </h2>
                        <p style={{ fontSize: "14px", maxWidth: "480px", margin: "0 auto 20px auto", color: "#64748b" }}>
                            Click <strong>"Use My Location"</strong> or select your neighborhood collection point to track only the waste collection vehicle assigned to your area.
                        </p>
                        <button
                            onClick={handleUseMyLocation}
                            style={{
                                backgroundColor: "#047857",
                                color: "white",
                                padding: "11px 22px",
                                borderRadius: "8px",
                                border: "none",
                                fontWeight: "700",
                                fontSize: "14px",
                                cursor: "pointer"
                            }}
                        >
                            🎯 Use My Location
                        </button>
                    </div>
                )}

                {/* ERROR STATE: No collection point found */}
                {locationMode && trackingError && (
                    <div style={{
                        backgroundColor: "#fef2f2",
                        padding: "20px",
                        borderRadius: "12px",
                        border: "1px solid #fecaca",
                        color: "#991b1b",
                        textAlign: "center",
                        marginBottom: "20px"
                    }}>
                        <div style={{ fontSize: "32px", marginBottom: "6px" }}>⚠️</div>
                        <div style={{ fontWeight: "800", fontSize: "16px" }}>{trackingError}</div>
                        <p style={{ fontSize: "13px", color: "#7f1d1d", marginTop: "4px" }}>
                            Please select a specific collection point from the dropdown above.
                        </p>
                    </div>
                )}

                {/* ACTIVE REAL-TIME TRACKING EXPERIENCE */}
                {locationMode && trackingData && trackingData.found && (
                    <div>
                        {/* 4 CLEAR INFORMATION CARDS */}
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                            gap: "16px",
                            marginBottom: "20px"
                        }}>
                            {/* CARD 1: MY WASTE COLLECTION / STATUS */}
                            <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                    MY WASTE COLLECTION
                                </div>
                                <div style={{ fontSize: "18px", fontWeight: "800", color: "#047857", marginTop: "6px" }}>
                                    📍 {pointData?.name}
                                </div>
                                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                                    {pointData?.ward} • {pointData?.address}
                                </div>

                                <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #f1f5f9" }}>
                                    <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600" }}>STATUS</div>
                                    <div style={{
                                        fontSize: "14px",
                                        fontWeight: "800",
                                        marginTop: "2px",
                                        color:
                                            delayData?.statusTone === "COMPLETED" ? "#16a34a" :
                                            delayData?.statusTone === "DELAYED" ? "#d97706" :
                                            delayData?.statusTone === "MISSED" ? "#dc2626" :
                                            delayData?.statusTone === "MAINTENANCE" ? "#dc2626" :
                                            "#0f172a"
                                    }}>
                                        {delayData?.statusText || "🟢 On Time"}
                                    </div>

                                    {/* Expected arrival / actual arrival */}
                                    <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                                        {collectionData?.actualArrival ? (
                                            <span style={{ color: "#16a34a", fontWeight: "700" }}>
                                                ✓ Actual Arrival: {collectionData.actualArrival}
                                            </span>
                                        ) : collectionData?.expectedArrival ? (
                                            <span>
                                                Expected Arrival: <strong>{collectionData.expectedArrival}</strong>
                                                {delayData?.isDelayed && delayData?.minutes > 0 && (
                                                    <span style={{ color: "#b45309", marginLeft: "4px", fontWeight: "700" }}>
                                                        (Delayed by {delayData.minutes} mins)
                                                    </span>
                                                )}
                                            </span>
                                        ) : (
                                            <span style={{ color: "#64748b" }}>Arrival time unavailable</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* CARD 2: VEHICLE DETAILS */}
                            <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                    VEHICLE DETAILS
                                </div>
                                {vehicleData ? (
                                    <div>
                                        <div style={{ fontSize: "20px", fontWeight: "800", color: "#0f172a", marginTop: "6px" }}>
                                            🚛 {vehicleData.vehicleNumber || vehicleData.vehicle_number}
                                        </div>
                                        <div style={{ marginTop: "8px" }}>
                                            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600" }}>VEHICLE STATUS</div>
                                            <span style={{
                                                display: "inline-block",
                                                marginTop: "2px",
                                                padding: "3px 10px",
                                                borderRadius: "12px",
                                                fontSize: "12px",
                                                fontWeight: "800",
                                                backgroundColor: vehicleData.status === "MAINTENANCE" ? "#fee2e2" : "#dcfce7",
                                                color: vehicleData.status === "MAINTENANCE" ? "#b91c1c" : "#15803d"
                                            }}>
                                                {vehicleData.status === "MAINTENANCE" ? "MAINTENANCE" : (vehicleData.status || "IN_SERVICE")}
                                            </span>
                                        </div>
                                        {pointData?.distanceFromCitizen !== null && pointData?.distanceFromCitizen !== undefined && (
                                            <div style={{ fontSize: "12px", color: "#2563eb", fontWeight: "600", marginTop: "8px" }}>
                                                🚶 {pointData.distanceFromCitizen} km from your location
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: "13px", color: "#dc2626", marginTop: "10px", fontWeight: "600" }}>
                                        No vehicle has been assigned to this collection point yet.
                                    </div>
                                )}
                            </div>

                            {/* CARD 3: DRIVER DETAILS & CALL DRIVER */}
                            <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                    DRIVER DETAILS
                                </div>
                                {driverData ? (
                                    <div>
                                        <div style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a", marginTop: "6px" }}>
                                            👤 {driverData.name}
                                        </div>
                                        <div style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>
                                            📞 {driverData.phone ? driverData.phone : <span style={{ color: "#94a3b8" }}>Phone number unavailable</span>}
                                        </div>

                                        {/* Call Driver Button */}
                                        <div style={{ marginTop: "12px" }}>
                                            {driverData.phone && driverData.phone.trim() !== "" ? (
                                                <a
                                                    href={`tel:${driverData.phone.replace(/\s+/g, '')}`}
                                                    style={{
                                                        display: "inline-flex",
                                                        alignItems: "center",
                                                        gap: "6px",
                                                        backgroundColor: "#047857",
                                                        color: "white",
                                                        padding: "8px 16px",
                                                        borderRadius: "8px",
                                                        textDecoration: "none",
                                                        fontWeight: "700",
                                                        fontSize: "13px",
                                                        boxShadow: "0 2px 4px rgba(4,120,87,0.2)"
                                                    }}
                                                >
                                                    <span>📞</span>
                                                    <span>Call Driver</span>
                                                </a>
                                            ) : (
                                                <button
                                                    disabled
                                                    style={{
                                                        backgroundColor: "#f1f5f9",
                                                        color: "#94a3b8",
                                                        padding: "8px 16px",
                                                        borderRadius: "8px",
                                                        border: "1px solid #e2e8f0",
                                                        fontSize: "12px",
                                                        fontWeight: "600",
                                                        cursor: "not-allowed"
                                                    }}
                                                >
                                                    Phone Unavailable
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: "13px", color: "#64748b", marginTop: "10px" }}>
                                        Driver details unavailable
                                    </div>
                                )}
                            </div>

                            {/* CARD 4: LIVE GPS DISTANCE & STATUS */}
                            <div style={{ backgroundColor: "#ffffff", padding: "18px 20px", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                    LIVE TRACKING GPS
                                </div>
                                {trackingGps && trackingGps.distanceFromCollectionPoint !== null && trackingGps.distanceFromCollectionPoint !== undefined ? (
                                    <div>
                                        <div style={{ fontSize: "20px", fontWeight: "800", color: "#d97706", marginTop: "6px" }}>
                                            {trackingGps.distanceFromCollectionPoint} km
                                        </div>
                                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                                            Distance from collection point
                                        </div>
                                        <div style={{ fontSize: "12px", color: "#334155", fontWeight: "600", marginTop: "8px" }}>
                                            {getGpsStatusText()}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: "13px", color: "#64748b", marginTop: "10px" }}>
                                        Vehicle location is currently unavailable.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* LIVE TRACKING MAP (LARGE) */}
                        <div style={{
                            backgroundColor: "#ffffff",
                            padding: "18px",
                            borderRadius: "14px",
                            border: "1px solid #e2e8f0",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.04)"
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
                                <div>
                                    <h3 style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                                        🗺️ Live Waste Collection Map
                                    </h3>
                                    <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0 0" }}>
                                        Showing your location, nearest collection point, and assigned vehicle
                                    </p>
                                </div>

                                {/* Map Action Buttons */}
                                <div style={{ display: "flex", gap: "8px" }}>
                                    {citizenPos && (
                                        <button
                                            onClick={() => setMapAction({ type: "MY_LOCATION", ts: Date.now() })}
                                            style={{
                                                backgroundColor: "#f1f5f9",
                                                color: "#2563eb",
                                                border: "1px solid #cbd5e1",
                                                padding: "6px 12px",
                                                borderRadius: "6px",
                                                fontSize: "12px",
                                                fontWeight: "700",
                                                cursor: "pointer"
                                            }}
                                        >
                                            📍 My Location
                                        </button>
                                    )}
                                    {vehiclePos && (
                                        <button
                                            onClick={() => setMapAction({ type: "FIND_VEHICLE", ts: Date.now() })}
                                            style={{
                                                backgroundColor: "#f1f5f9",
                                                color: "#d97706",
                                                border: "1px solid #cbd5e1",
                                                padding: "6px 12px",
                                                borderRadius: "6px",
                                                fontSize: "12px",
                                                fontWeight: "700",
                                                cursor: "pointer"
                                            }}
                                        >
                                            🚛 Find Vehicle
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setMapAction({ type: "FIT_VIEW", ts: Date.now() })}
                                        style={{
                                            backgroundColor: "#f1f5f9",
                                            color: "#047857",
                                            border: "1px solid #cbd5e1",
                                            padding: "6px 12px",
                                            borderRadius: "6px",
                                            fontSize: "12px",
                                            fontWeight: "700",
                                            cursor: "pointer"
                                        }}
                                    >
                                        🗺️ Fit View
                                    </button>
                                </div>
                            </div>

                            {/* Map Container */}
                            <div style={{ height: "460px", borderRadius: "10px", overflow: "hidden", border: "1px solid #cbd5e1" }}>
                                <MapContainer
                                    center={defaultCenter}
                                    zoom={14}
                                    style={{ height: "100%", width: "100%" }}
                                >
                                    <TileLayer
                                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                    />

                                    <CitizenMapController
                                        citizenPos={citizenPos}
                                        pointPos={pointPos}
                                        vehiclePos={vehiclePos}
                                        actionTrigger={mapAction}
                                    />

                                    {/* Citizen Marker */}
                                    {citizenPos && (
                                        <Marker position={[citizenPos.latitude, citizenPos.longitude]} icon={citizenIcon}>
                                            <Popup>
                                                <div style={{ fontSize: "13px" }}>
                                                    <strong>📍 Your Location</strong><br />
                                                    {pointData?.distanceFromCitizen !== null && (
                                                        <span>{pointData.distanceFromCitizen} km to collection point</span>
                                                    )}
                                                </div>
                                            </Popup>
                                        </Marker>
                                    )}

                                    {/* Relevant Collection Point Marker */}
                                    {pointPos && (
                                        <Marker position={[pointPos.latitude, pointPos.longitude]} icon={pointIcon}>
                                            <Popup>
                                                <div style={{ fontSize: "13px" }}>
                                                    <strong>Collection Point: {pointData.name}</strong><br />
                                                    📍 {pointData.address} ({pointData.ward})<br />
                                                    Expected Arrival: <strong>{collectionData?.expectedArrival || pointData.scheduledTime || "09:00 AM"}</strong><br />
                                                    Status: <strong>{collectionData?.status || "Pending"}</strong>
                                                </div>
                                            </Popup>
                                        </Marker>
                                    )}

                                    {/* Assigned Vehicle Marker (ONLY this vehicle) */}
                                    {vehiclePos && (
                                        <Marker position={[vehiclePos.latitude, vehiclePos.longitude]} icon={vehicleIcon}>
                                            <Popup>
                                                <div style={{ fontSize: "13px" }}>
                                                    <strong>Vehicle: {vehicleData?.vehicleNumber || vehicleData?.vehicle_number}</strong><br />
                                                    Driver: {driverData?.name || "Unassigned"}<br />
                                                    Status: <strong>{delayData?.statusText || vehicleData?.status}</strong><br />
                                                    Last updated: {getGpsStatusText()}<br />
                                                    {trackingGps?.distanceFromCollectionPoint !== null && (
                                                        <span>Distance to point: <strong>{trackingGps.distanceFromCollectionPoint} km</strong></span>
                                                    )}
                                                </div>
                                            </Popup>
                                        </Marker>
                                    )}

                                    {/* Direct Tracking Line between Vehicle and Collection Point */}
                                    {lineCoords.length === 2 && (
                                        <Polyline
                                            positions={lineCoords}
                                            color="#d97706"
                                            weight={4}
                                            dashArray="8, 8"
                                            opacity={0.85}
                                        />
                                    )}
                                </MapContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "'Inter', sans-serif" }}>
            <Navbar user={user} onLogout={onLogout} />
            <div style={{ display: "flex" }}>
                <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} role="CITIZEN" onLogout={onLogout} />
                <main style={{ flex: 1, minHeight: "calc(100vh - 64px)" }}>
                    {renderCitizenContent()}
                </main>
            </div>
        </div>
    );
}

export default CitizenDashboard;