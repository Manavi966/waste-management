import React, { useEffect, useState } from "react";
import api from "../services/api";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import VehiclesPage from "./VehiclesPage";
import AssignVehiclePage from "./AssignVehiclePage";
import ComplaintsPage from "./ComplaintsPage";
import CollectionVerificationPage from "./CollectionVerificationPage";

function AuthorityDashboard({ user, onLogout }) {
    const [activeTab, setActiveTab] = useState("dashboard");
    const [selectedVehicleId, setSelectedVehicleId] = useState(null);
    const [selectedDate, setSelectedDateState] = useState(() => {
        return localStorage.getItem("authority_operation_date") || "2026-09-20";
    });
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Replacement Modal State
    const [replacementModal, setReplacementModal] = useState(null); // { maintenanceVehicleId, vehicleNumber, affectedArea }
    const [selectedReplacementVehicleId, setSelectedReplacementVehicleId] = useState("");
    const [assigningReplacement, setAssigningReplacement] = useState(false);
    const [modalMessage, setModalMessage] = useState("");

    const setSelectedDate = (newDate) => {
        setSelectedDateState(newDate);
        localStorage.setItem("authority_operation_date", newDate);
    };

    const fetchDashboard = async () => {
        try {
            const response = await api.get(`/admin/dashboard?date=${selectedDate}`);
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
    }, [selectedDate]);

    const handleManageVehicle = (vehicleId) => {
        setSelectedVehicleId(vehicleId);
        setActiveTab("vehicles");
    };

    const handleOpenReplacementModal = (alert) => {
        setReplacementModal({
            maintenanceVehicleId: alert.vehicle_id,
            vehicleNumber: alert.vehicle_number,
            affectedArea: alert.affected_area
        });
        setSelectedReplacementVehicleId("");
        setModalMessage("");
    };

    const handleConfirmReplacement = async (e) => {
        e.preventDefault();
        if (!selectedReplacementVehicleId) {
            setModalMessage("Please select a replacement vehicle from the dropdown.");
            return;
        }

        setAssigningReplacement(true);
        setModalMessage("");

        try {
            const response = await api.post("/admin/assign-replacement", {
                maintenance_vehicle_id: replacementModal.maintenanceVehicleId,
                replacement_vehicle_id: Number(selectedReplacementVehicleId),
                ward: replacementModal.affectedArea,
                start_date: selectedDate
            });

            alert(response.data.message || "Replacement vehicle assigned successfully.");
            setReplacementModal(null);
            fetchDashboard();
        } catch (err) {
            console.error("Failed to assign replacement:", err);
            setModalMessage(err.response?.data?.message || "Failed to assign replacement vehicle.");
        } finally {
            setAssigningReplacement(false);
        }
    };

    const handleEndReplacement = async (alert) => {
        if (!window.confirm(`End temporary replacement coverage for ${alert.affected_area}?`)) {
            return;
        }
        try {
            await api.post("/admin/remove-replacement", {
                ward: alert.affected_area
            });
            alert(`Temporary replacement coverage ended for ${alert.affected_area}.`);
            fetchDashboard();
        } catch (err) {
            alert(err.response?.data?.message || "Failed to end replacement.");
        }
    };

    const renderMainContent = () => {
        switch (activeTab) {
            case "verification":
                return (
                    <CollectionVerificationPage
                        selectedDate={selectedDate}
                        setSelectedDate={setSelectedDate}
                    />
                );
            case "vehicles":
                return (
                    <VehiclesPage
                        selectedDate={selectedDate}
                        setSelectedDate={setSelectedDate}
                        initialVehicleId={selectedVehicleId}
                        onClearInitialVehicle={() => setSelectedVehicleId(null)}
                    />
                );
            case "assign-vehicle":
                return (
                    <AssignVehiclePage
                        selectedDate={selectedDate}
                        setSelectedDate={setSelectedDate}
                    />
                );
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
                const maintenanceAlerts = dashboard.maintenance_alerts || [];
                const eligibleReplacements = dashboard.eligible_replacements || [];

                return (
                    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
                            <div>
                                <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Dashboard</h1>
                                <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>System overview and municipal waste collection management</p>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", backgroundColor: "white", padding: "6px 14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                                <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>📅 Operation Date:</span>
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    style={{ border: "1px solid #cbd5e1", borderRadius: "6px", padding: "4px 8px", fontSize: "13px", fontWeight: "600" }}
                                />
                            </div>
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

                            {/* Card 2: Master Collection Points */}
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
                                    <span style={{ fontSize: "13px", fontWeight: "600", textTransform: "uppercase", opacity: 0.9 }}>Master Collection Zones</span>
                                    <span style={{ fontSize: "24px" }}>📍</span>
                                </div>
                                <div style={{ fontSize: "36px", fontWeight: "800", marginTop: "12px" }}>{dashboard?.total_collection_points ?? 25}</div>
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

                        {/* VEHICLE MAINTENANCE ALERTS SECTION */}
                        {maintenanceAlerts.length > 0 && (
                            <div style={{
                                backgroundColor: "#fff5f5",
                                padding: "20px 24px",
                                borderRadius: "12px",
                                border: "1px solid #fca5a5",
                                marginBottom: "28px"
                            }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                                    <span style={{ fontSize: "22px" }}>⚠</span>
                                    <h3 style={{ fontSize: "17px", fontWeight: "800", color: "#991b1b", margin: 0 }}>
                                        Vehicle Maintenance Alerts ({maintenanceAlerts.length})
                                    </h3>
                                </div>
                                <p style={{ fontSize: "13px", color: "#7f1d1d", margin: "0 0 16px 0" }}>
                                    The following vehicles are under maintenance. Higher Authority decision is required to assign temporary replacement vehicles.
                                </p>

                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
                                    {maintenanceAlerts.map((alert) => (
                                        <div
                                            key={alert.vehicle_id}
                                            style={{
                                                backgroundColor: "#ffffff",
                                                padding: "16px 18px",
                                                borderRadius: "10px",
                                                border: "1px solid #fecaca",
                                                boxShadow: "0 2px 4px rgba(0,0,0,0.03)"
                                            }}
                                        >
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                                                <div>
                                                    <span style={{ fontSize: "15px", fontWeight: "800", color: "#991b1b" }}>
                                                        🚛 {alert.vehicle_number}
                                                    </span>
                                                    <span style={{ marginLeft: "8px", fontSize: "11px", fontWeight: "700", padding: "2px 8px", borderRadius: "10px", backgroundColor: "#fee2e2", color: "#b91c1c" }}>
                                                        MAINTENANCE
                                                    </span>
                                                </div>
                                            </div>

                                            <div style={{ fontSize: "13px", color: "#334155", display: "flex", flexDirection: "column", gap: "4px", marginBottom: "14px" }}>
                                                <div>📍 <strong>Permanent Area:</strong> {alert.affected_area}</div>
                                                <div>👤 <strong>Driver:</strong> {alert.driver_name}</div>
                                                <div>⚠️ <strong>Today's Collection:</strong> <span style={{ color: "#dc2626", fontWeight: "700" }}>{alert.collection_status}</span></div>
                                                <div>
                                                    🔄 <strong>Replacement:</strong>{" "}
                                                    {alert.replacement_assigned ? (
                                                        <span style={{ color: "#15803d", fontWeight: "700" }}>
                                                            ✓ Assigned ({alert.replacement_vehicle?.vehicle_number})
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: "#b45309", fontWeight: "700" }}>
                                                            Not Assigned
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div style={{ display: "flex", gap: "8px" }}>
                                                <button
                                                    onClick={() => handleOpenReplacementModal(alert)}
                                                    style={{
                                                        flex: 1,
                                                        backgroundColor: "#047857",
                                                        color: "white",
                                                        padding: "8px 14px",
                                                        borderRadius: "6px",
                                                        border: "none",
                                                        fontSize: "12px",
                                                        fontWeight: "700",
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    {alert.replacement_assigned ? "Change Replacement Vehicle" : "Assign Replacement Vehicle"}
                                                </button>

                                                {alert.replacement_assigned && (
                                                    <button
                                                        onClick={() => handleEndReplacement(alert)}
                                                        style={{
                                                            backgroundColor: "#fee2e2",
                                                            color: "#b91c1c",
                                                            padding: "8px 12px",
                                                            borderRadius: "6px",
                                                            border: "1px solid #fca5a5",
                                                            fontSize: "12px",
                                                            fontWeight: "600",
                                                            cursor: "pointer"
                                                        }}
                                                    >
                                                        End Replacement
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

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
                                        <th style={{ padding: "10px 12px" }}>Permanent Area</th>
                                        <th style={{ padding: "10px 12px" }}>Status</th>
                                        <th style={{ padding: "10px 12px" }}>Assigned Stops</th>
                                        <th style={{ padding: "10px 12px" }}>Completed</th>
                                        <th style={{ padding: "10px 12px", textAlign: "right" }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(dashboard.vehicle_status || []).map((v) => (
                                        <tr key={v.vehicle_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                            <td style={{ padding: "10px 12px", fontWeight: "700", color: "#047857" }}>{v.vehicle_number}</td>
                                            <td style={{ padding: "10px 12px", color: "#334155" }}>{v.driver_name || "Unassigned"}</td>
                                            <td style={{ padding: "10px 12px", color: "#0284c7", fontWeight: "600" }}>
                                                {v.permanent_ward || "Unassigned"}
                                                {v.temporary_ward && (
                                                    <span style={{ display: "block", fontSize: "11px", color: "#d97706", fontWeight: "700" }}>
                                                        Covering: {v.temporary_ward} (Temp)
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: "10px 12px" }}>
                                                <span style={{
                                                    padding: "3px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "700",
                                                    backgroundColor: (v.vehicle_status || "").toUpperCase() === "MAINTENANCE" ? "#fee2e2" : "#dcfce7",
                                                    color: (v.vehicle_status || "").toUpperCase() === "MAINTENANCE" ? "#b91c1c" : "#15803d",
                                                    border: `1px solid ${(v.vehicle_status || "").toUpperCase() === "MAINTENANCE" ? "#fca5a5" : "#bbf7d0"}`
                                                }}>
                                                    {(v.vehicle_status || "").toUpperCase() === "MAINTENANCE" ? "🔧 MAINTENANCE" : "🟢 IN SERVICE"}
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
                                            <div style={{ fontSize: "12px", color: "#64748b", margin: "4px 0" }}>📍 {m.address} ({m.ward})</div>
                                            <div style={{ fontSize: "12px", color: "#334155" }}>🚛 Vehicle: <strong>{m.vehicle_number}</strong></div>
                                            <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px" }}>❌ Reason: {m.miss_reason}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ASSIGN REPLACEMENT VEHICLE MODAL */}
                        {replacementModal && (
                            <div style={{
                                position: "fixed",
                                top: 0, left: 0, right: 0, bottom: 0,
                                backgroundColor: "rgba(0,0,0,0.5)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                zIndex: 1000
                            }}>
                                <div style={{ backgroundColor: "white", padding: "28px", borderRadius: "12px", width: "480px", maxWidth: "90%" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                        <h3 style={{ margin: 0, color: "#0f172a", fontSize: "18px", fontWeight: "800" }}>
                                            Assign Replacement Vehicle
                                        </h3>
                                        <button
                                            onClick={() => setReplacementModal(null)}
                                            style={{ border: "none", background: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    <div style={{ backgroundColor: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "16px", fontSize: "13px" }}>
                                        <div>🔧 <strong>Maintenance Vehicle:</strong> {replacementModal.vehicleNumber}</div>
                                        <div style={{ marginTop: "4px" }}>📍 <strong>Affected Service Area:</strong> {replacementModal.affectedArea}</div>
                                        <div style={{ marginTop: "4px" }}>📅 <strong>Operation Date:</strong> {selectedDate}</div>
                                    </div>

                                    <form onSubmit={handleConfirmReplacement}>
                                        <div style={{ marginBottom: "16px" }}>
                                            <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                                                Select Eligible Replacement Vehicle
                                            </label>
                                            <select
                                                value={selectedReplacementVehicleId}
                                                onChange={(e) => setSelectedReplacementVehicleId(e.target.value)}
                                                required
                                                style={{ width: "100%", padding: "10px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                                            >
                                                <option value="">-- Choose an Available Vehicle --</option>
                                                {eligibleReplacements
                                                    .filter(v => v.id.toString() !== replacementModal.maintenanceVehicleId.toString())
                                                    .map((v) => (
                                                        <option key={v.id} value={v.id}>
                                                            {v.vehicle_number} — [{v.status}] — Driver: {v.driver_name || "Unassigned"} (Permanent: {v.permanent_ward || "None"})
                                                        </option>
                                                    ))}
                                            </select>
                                        </div>

                                        {modalMessage && (
                                            <div style={{ padding: "10px", backgroundColor: "#fef2f2", color: "#dc2626", borderRadius: "6px", fontSize: "13px", marginBottom: "14px" }}>
                                                {modalMessage}
                                            </div>
                                        )}

                                        <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 16px 0" }}>
                                            * Note: The selected vehicle will temporarily service <strong>{replacementModal.affectedArea}</strong>. Its permanent assignment remains unchanged.
                                        </p>

                                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                                            <button
                                                type="button"
                                                onClick={() => setReplacementModal(null)}
                                                style={{ padding: "9px 16px", borderRadius: "6px", border: "1px solid #cbd5e1", backgroundColor: "white", cursor: "pointer", fontWeight: "600" }}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={assigningReplacement}
                                                style={{ padding: "9px 20px", borderRadius: "6px", border: "none", backgroundColor: "#047857", color: "white", cursor: "pointer", fontWeight: "700" }}
                                            >
                                                {assigningReplacement ? "Assigning..." : "Confirm Replacement"}
                                            </button>
                                        </div>
                                    </form>
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