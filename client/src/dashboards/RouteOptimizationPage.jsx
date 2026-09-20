import React, { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import api from "../services/api";
import "leaflet/dist/leaflet.css";

// Leaflet icon fix
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});

function RouteOptimizationPage() {
    const [vehicles, setVehicles] = useState([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState("");
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
    const [routeData, setRouteData] = useState(null);
    const [stops, setStops] = useState([]);
    const [loading, setLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const [message, setMessage] = useState("");

    useEffect(() => {
        const loadVehicles = async () => {
            try {
                const response = await api.get("/vehicles");
                setVehicles(response.data);
                if (response.data.length > 0) {
                    setSelectedVehicleId(response.data[0].id.toString());
                }
            } catch (err) {
                console.error("Error loading vehicles:", err);
            }
        };
        loadVehicles();
    }, []);

    const fetchRoute = async () => {
        if (!selectedVehicleId) return;
        setLoading(true);
        setMessage("");
        try {
            // Find route ID for vehicle and date or auto-assign if missing
            const response = await api.get(`/admin/dashboard?date=${selectedDate}`);
            const vehicleWork = response.data.vehicle_status.find(v => v.vehicle_id === Number(selectedVehicleId));

            if (vehicleWork && vehicleWork.route_id) {
                const routeRes = await api.get(`/routes/${vehicleWork.route_id}`);
                setRouteData(routeRes.data.route);
                setStops(routeRes.data.stops);
            } else {
                setRouteData(null);
                setStops([]);
                setMessage("No assigned route found for this vehicle and date. Click 'Auto-Assign' or 'Optimize Route'.");
            }
        } catch (err) {
            console.error("Error fetching route:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRoute();
    }, [selectedVehicleId, selectedDate]);

    const handleAutoAssignAndOptimize = async () => {
        setOptimizing(true);
        try {
            // 1. Auto Assign Points
            await api.post("/routes/auto-assign", { route_date: selectedDate });
            
            // 2. Fetch Dashboard to get route ID
            const dashRes = await api.get(`/admin/dashboard?date=${selectedDate}`);
            const vehicleWork = dashRes.data.vehicle_status.find(v => v.vehicle_id === Number(selectedVehicleId));

            if (vehicleWork && vehicleWork.route_id) {
                // 3. Optimize sequence
                const optRes = await api.post(`/routes/${vehicleWork.route_id}/optimize`);
                setMessage(`Route optimized! Total Distance: ${optRes.data.total_distance_km} km.`);
                await fetchRoute();
            } else {
                setMessage("Automatic assignment finished. Select another date or check vehicle GPS status.");
            }
        } catch (err) {
            console.error("Optimization error:", err);
            setMessage(err.response?.data?.message || "Failed to optimize route.");
        } finally {
            setOptimizing(false);
        }
    };

    const polylinePositions = stops.map(s => [Number(s.latitude), Number(s.longitude)]);
    const mapCenter = polylinePositions.length > 0 ? polylinePositions[0] : [12.9716, 77.5946];

    return (
        <div style={{ padding: "24px", maxWidth: "1300px", margin: "0 auto" }}>
            <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: "0 0 6px 0" }}>
                Route Optimization & Live Tracking
            </h1>
            <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 20px 0" }}>
                Sequence collection points to minimize travel distance, fuel consumption, and travel time.
            </p>

            {/* Selection & Control Bar */}
            <div style={{
                backgroundColor: "#ffffff",
                padding: "20px",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                display: "flex",
                gap: "20px",
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: "24px"
            }}>
                <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#475569", marginBottom: "6px" }}>Select Vehicle</label>
                    <select
                        value={selectedVehicleId}
                        onChange={(e) => setSelectedVehicleId(e.target.value)}
                        style={{ padding: "8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", minWidth: "220px", fontSize: "14px" }}
                    >
                        {vehicles.map(v => (
                            <option key={v.id} value={v.id}>V-0{v.id} ({v.vehicle_number})</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#475569", marginBottom: "6px" }}>Date</label>
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        style={{ padding: "8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                    />
                </div>

                <div style={{ marginTop: "18px" }}>
                    <button
                        onClick={handleAutoAssignAndOptimize}
                        disabled={optimizing}
                        style={{
                            backgroundColor: "#047857",
                            color: "white",
                            padding: "10px 20px",
                            borderRadius: "6px",
                            border: "none",
                            fontWeight: "600",
                            cursor: "pointer",
                            fontSize: "14px"
                        }}
                    >
                        {optimizing ? "Optimizing Route..." : "⚡ Optimize Route"}
                    </button>
                </div>

                {message && (
                    <div style={{ marginTop: "18px", fontSize: "13px", color: "#047857", fontWeight: "600" }}>
                        {message}
                    </div>
                )}
            </div>

            {/* Split Content View */}
            <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: "24px", alignItems: "start" }}>
                
                {/* Left Panel: Optimized Sequence List */}
                <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", marginTop: 0, marginBottom: "16px" }}>
                        Optimized Route
                    </h3>

                    {routeData && (
                        <div style={{ backgroundColor: "#f8fafc", padding: "12px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                <span style={{ color: "#64748b" }}>Total Distance:</span>
                                <strong style={{ color: "#047857" }}>{routeData.total_distance || 0} km</strong>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ color: "#64748b" }}>Estimated Time:</span>
                                <strong style={{ color: "#1e293b" }}>{routeData.estimated_time || Math.round((routeData.total_distance || 0) * 2.4)} mins</strong>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <p style={{ fontSize: "14px", color: "#64748b" }}>Loading route sequence...</p>
                    ) : stops.length === 0 ? (
                        <p style={{ fontSize: "14px", color: "#64748b" }}>No collection points assigned yet. Click 'Optimize Route' to generate.</p>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                            {stops.map((stop, idx) => (
                                <div key={stop.id} style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    padding: "12px",
                                    borderRadius: "8px",
                                    border: "1px solid #e2e8f0",
                                    backgroundColor: stop.status === "COMPLETED" ? "#f0fdf4" : stop.status === "MISSED" ? "#fef2f2" : "#ffffff"
                                }}>
                                    <div style={{
                                        width: "28px",
                                        height: "28px",
                                        borderRadius: "50%",
                                        backgroundColor: stop.status === "COMPLETED" ? "#16a34a" : stop.status === "MISSED" ? "#dc2626" : "#047857",
                                        color: "white",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontWeight: "bold",
                                        fontSize: "13px"
                                    }}>
                                        {idx + 1}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>{stop.name}</div>
                                        <div style={{ fontSize: "12px", color: "#64748b" }}>{stop.scheduled_time || "09:00 AM"}</div>
                                    </div>
                                    <span style={{
                                        fontSize: "11px",
                                        padding: "2px 8px",
                                        borderRadius: "10px",
                                        fontWeight: "600",
                                        backgroundColor: stop.status === "COMPLETED" ? "#dcfce7" : stop.status === "MISSED" ? "#fee2e2" : "#f1f5f9",
                                        color: stop.status === "COMPLETED" ? "#15803d" : stop.status === "MISSED" ? "#b91c1c" : "#475569"
                                    }}>
                                        {stop.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right Panel: Map Visualization */}
                <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "12px", border: "1px solid #e2e8f0", height: "550px" }}>
                    <MapContainer
                        center={mapCenter}
                        zoom={13}
                        style={{ height: "100%", width: "100%", borderRadius: "8px" }}
                    >
                        <TileLayer
                            attribution='&copy; OpenStreetMap contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />

                        {/* Draw Route Polyline */}
                        {polylinePositions.length > 1 && (
                            <Polyline positions={polylinePositions} color="#047857" weight={4} dashArray="5, 10" />
                        )}

                        {/* Render Stop Markers */}
                        {stops.map((stop, idx) => (
                            <Marker key={stop.id} position={[Number(stop.latitude), Number(stop.longitude)]}>
                                <Popup>
                                    <div style={{ padding: "4px" }}>
                                        <h4 style={{ margin: "0 0 4px 0", color: "#047857" }}>{idx + 1}. {stop.name}</h4>
                                        <p style={{ margin: "0 0 4px 0", fontSize: "12px" }}>{stop.address}</p>
                                        <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>Status: <strong>{stop.status}</strong></p>
                                    </div>
                                </Popup>
                            </Marker>
                        ))}
                    </MapContainer>
                </div>

            </div>
        </div>
    );
}

export default RouteOptimizationPage;
