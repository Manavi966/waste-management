import React, { useEffect, useState } from "react";
import api from "../services/api";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import VehiclesPage from "./VehiclesPage";
import AssignVehiclePage from "./AssignVehiclePage";
import ComplaintsPage from "./ComplaintsPage";

function AuthorityDashboard({ user, onLogout }) {
    const [activeTab, setActiveTab] = useState("dashboard");
    const [selectedVehicleId, setSelectedVehicleId] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchDashboard = async () => {
        try {
            const response = await api.get("/admin/dashboard");
            setDashboard(response.data);
            setError("");
        } catch (err) {
            console.error(err);
            setError("Failed to load authority dashboard.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDashboard();
    }, []);

    const handleManageVehicle = (vehicleId) => {
        setSelectedVehicleId(vehicleId);
        setActiveTab("vehicles");
    };

    const renderMainContent = () => {
        switch (activeTab) {
            case "vehicles":
                return (
                    <VehiclesPage
                        initialVehicleId={selectedVehicleId}
                        onClearInitialVehicle={() => setSelectedVehicleId(null)}
                    />
                );
            case "assign-vehicle":
                return <AssignVehiclePage />;
            case "complaints":
                return <ComplaintsPage />;
            case "dashboard":
            default:
                if (loading) return <div style={{ padding: "30px" }}>Loading Authority Dashboard...</div>;
                if (error) return <div style={{ padding: "30px", color: "red" }}>{error}</div>;
                if (!dashboard) return <div style={{ padding: "30px" }}>No dashboard data available.</div>;

                const vehicles = dashboard.vehicles;
                const collections = dashboard.collections;
                const missedLocations = dashboard.missed_locations || [];

                return (
                    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
                        <div style={{ marginBottom: "24px" }}>
                            <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Dashboard</h1>
                            <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>System overview and operational performance</p>
                        </div>

                        {/* Top KPI Cards */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "28px" }}>
                            {/* Card 1: Total Vehicles */}
                            <div
                                onClick={() => setActiveTab("vehicles")}
                                style={{
                                    backgroundColor: "#10b981",
                                    color: "white",
                                    padding: "24px",
                                    borderRadius: "12px",
                                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                                    cursor: "pointer",
                                    transition: "transform 0.15s ease"
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: "13px", fontWeight: "600", textTransform: "uppercase", opacity: 0.9 }}>Total Vehicles (Click to Manage)</span>
                                    <span style={{ fontSize: "24px" }}>🚛</span>
                                </div>
                                <div style={{ fontSize: "36px", fontWeight: "800", marginTop: "12px" }}>{vehicles?.total_vehicles || 0}</div>
                            </div>

                            {/* Card 2: Collection Points */}
                            <div
                                onClick={() => setActiveTab("assign-vehicle")}
                                style={{
                                    backgroundColor: "#3b82f6",
                                    color: "white",
                                    padding: "24px",
                                    borderRadius: "12px",
                                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                                    cursor: "pointer"
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: "13px", fontWeight: "600", textTransform: "uppercase", opacity: 0.9 }}>Collection Points (Assign)</span>
                                    <span style={{ fontSize: "24px" }}>📍</span>
                                </div>
                                <div style={{ fontSize: "36px", fontWeight: "800", marginTop: "12px" }}>25</div>
                            </div>

                            {/* Card 3: Completed Collections */}
                            <div style={{ backgroundColor: "#f59e0b", color: "white", padding: "24px", borderRadius: "12px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: "13px", fontWeight: "600", textTransform: "uppercase", opacity: 0.9 }}>Completed Collections</span>
                                    <span style={{ fontSize: "24px" }}>✓</span>
                                </div>
                                <div style={{ fontSize: "36px", fontWeight: "800", marginTop: "12px" }}>{collections?.completed_stops || 0}</div>
                            </div>

                            {/* Card 4: Missed Collections */}
                            <div
                                onClick={() => setActiveTab("vehicles")}
                                style={{
                                    backgroundColor: "#ef4444",
                                    color: "white",
                                    padding: "24px",
                                    borderRadius: "12px",
                                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.05)",
                                    cursor: "pointer"
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontSize: "13px", fontWeight: "600", textTransform: "uppercase", opacity: 0.9 }}>Missed Collections</span>
                                    <span style={{ fontSize: "24px" }}>⚠️</span>
                                </div>
                                <div style={{ fontSize: "36px", fontWeight: "800", marginTop: "12px" }}>{collections?.missed_stops || 0}</div>
                            </div>
                        </div>

                        {/* Vehicle Work Overview Table */}
                        <div style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "12px", border: "1px solid #e2e8f0", marginBottom: "28px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Vehicle Activity & Status</h3>
                                <button
                                    onClick={() => setActiveTab("vehicles")}
                                    style={{
                                        backgroundColor: "#f1f5f9",
                                        border: "1px solid #cbd5e1",
                                        borderRadius: "6px",
                                        padding: "6px 14px",
                                        fontSize: "12px",
                                        fontWeight: "600",
                                        color: "#047857",
                                        cursor: "pointer"
                                    }}
                                >
                                    Open Vehicles Page →
                                </button>
                            </div>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                                <thead>
                                    <tr style={{ borderBottom: "1px solid #e2e8f0", color: "#64748b" }}>
                                        <th style={{ padding: "10px 12px" }}>Vehicle</th>
                                        <th style={{ padding: "10px 12px" }}>Driver</th>
                                        <th style={{ padding: "10px 12px" }}>Status</th>
                                        <th style={{ padding: "10px 12px" }}>Assigned</th>
                                        <th style={{ padding: "10px 12px" }}>Completed</th>
                                        <th style={{ padding: "10px 12px", textAlign: "right" }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(dashboard.vehicle_status || []).map((v) => (
                                        <tr key={v.vehicle_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                            <td style={{ padding: "10px 12px", fontWeight: "700", color: "#047857" }}>{v.vehicle_number}</td>
                                            <td style={{ padding: "10px 12px", color: "#334155" }}>{v.driver_name || "Unassigned"}</td>
                                            <td style={{ padding: "10px 12px" }}>
                                                <span style={{
                                                    padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "600",
                                                    backgroundColor: v.vehicle_status === "ON_ROUTE" ? "#dbeafe" : v.vehicle_status === "MAINTENANCE" ? "#fee2e2" : "#dcfce7",
                                                    color: v.vehicle_status === "ON_ROUTE" ? "#1d4ed8" : v.vehicle_status === "MAINTENANCE" ? "#b91c1c" : "#15803d"
                                                }}>
                                                    {v.vehicle_status || "In Service"}
                                                </span>
                                            </td>
                                            <td style={{ padding: "10px 12px", color: "#334155" }}>{v.assigned || 0} stops</td>
                                            <td style={{ padding: "10px 12px", fontWeight: "600", color: "#16a34a" }}>{v.completed || 0} stops</td>
                                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                                                <button
                                                    onClick={() => handleManageVehicle(v.vehicle_id)}
                                                    style={{
                                                        padding: "4px 10px",
                                                        backgroundColor: "#047857",
                                                        color: "white",
                                                        border: "none",
                                                        borderRadius: "4px",
                                                        fontSize: "11px",
                                                        fontWeight: "600",
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    Manage
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Missed Locations List */}
                        {missedLocations.length > 0 && (
                            <div style={{ backgroundColor: "#fef2f2", padding: "20px", borderRadius: "12px", border: "1px solid #fecaca" }}>
                                <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#991b1b", marginTop: 0, marginBottom: "12px" }}>
                                    🔴 Missed Collection Alerts
                                </h3>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
                                    {missedLocations.map((m) => (
                                        <div key={m.id} style={{ backgroundColor: "white", padding: "14px", borderRadius: "8px", border: "1px solid #fca5a5" }}>
                                            <div style={{ fontWeight: "700", color: "#991b1b", fontSize: "14px" }}>{m.collection_point}</div>
                                            <div style={{ fontSize: "12px", color: "#64748b", margin: "4px 0" }}>📍 {m.address}</div>
                                            <div style={{ fontSize: "12px", color: "#334155" }}>🚛 Vehicle: <strong>{m.vehicle_number}</strong></div>
                                            <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px" }}>❌ Reason: {m.miss_reason}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
        }
    };

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "'Inter', sans-serif" }}>
            <Navbar user={user} onLogout={onLogout} />
            <div style={{ display: "flex" }}>
                <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} role="AUTHORITY" onLogout={onLogout} />
                <main style={{ flex: 1, minHeight: "calc(100vh - 64px)" }}>
                    {renderMainContent()}
                </main>
            </div>
        </div>
    );
}

export default AuthorityDashboard;