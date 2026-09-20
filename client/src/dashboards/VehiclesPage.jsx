import React, { useState, useEffect } from "react";
import api from "../services/api";

function VehiclesPage({ initialVehicleId, onClearInitialVehicle }) {
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [showAddModal, setShowAddModal] = useState(false);
    const [newVehicleNumber, setNewVehicleNumber] = useState("");
    const [newStatus, setNewStatus] = useState("AVAILABLE");

    // Vehicle Details Modal State
    const [selectedVehicleDetails, setSelectedVehicleDetails] = useState(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsTab, setDetailsTab] = useState("ALL"); // ALL, COMPLETED, PENDING, MISSED

    const fetchVehicles = async () => {
        try {
            const response = await api.get("/vehicles");
            setVehicles(response.data || []);
        } catch (error) {
            console.error("Failed to fetch vehicles:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchVehicles();
    }, []);

    useEffect(() => {
        if (initialVehicleId) {
            handleViewDetails(initialVehicleId);
        }
    }, [initialVehicleId]);

    const filteredVehicles = (vehicles || []).filter((v) => {
        if (!searchTerm) return true;
        const q = searchTerm.toLowerCase();
        const vNum = (v.vehicle_number || "").toLowerCase();
        const dName = (v.driver_name || "").toLowerCase();
        const vId = `v0${v.id}`.toLowerCase();
        return vNum.includes(q) || dName.includes(q) || vId.includes(q);
    });

    const handleAddVehicle = async (e) => {
        e.preventDefault();
        try {
            await api.post("/vehicles", {
                vehicle_number: newVehicleNumber,
                status: newStatus
            });
            setShowAddModal(false);
            setNewVehicleNumber("");
            fetchVehicles();
        } catch (error) {
            alert(error.response?.data?.message || "Failed to add vehicle");
        }
    };

    const handleViewDetails = async (vehicleId) => {
        setDetailsLoading(true);
        setDetailsTab("ALL");
        try {
            const response = await api.get(`/vehicles/${vehicleId}/details`);
            setSelectedVehicleDetails(response.data);
        } catch (error) {
            console.error("Fetch vehicle details error:", error);
            alert("Failed to load vehicle details.");
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleStatusChange = async (vehicleId, newStatus) => {
        try {
            const res = await api.put(`/vehicles/${vehicleId}`, { status: newStatus });
            if (res.data.requires_reassignment) {
                alert(`⚠️ ${res.data.message}\n\nPlease navigate to "Assign Vehicle" to reassign its collection points to an active vehicle.`);
            }
            fetchVehicles();
        } catch (error) {
            alert(error.response?.data?.message || "Failed to update vehicle status");
        }
    };

    const getStatusStyle = (status) => {
        switch (status) {
            case "MAINTENANCE":
                return { bg: "#fee2e2", color: "#b91c1c", border: "#fca5a5" };
            case "IN_SERVICE":
            case "ACTIVE":
                return { bg: "#dbeafe", color: "#1d4ed8", border: "#bfdbfe" };
            case "ON_ROUTE":
                return { bg: "#e0e7ff", color: "#4338ca", border: "#c7d2fe" };
            case "INACTIVE":
                return { bg: "#f1f5f9", color: "#64748b", border: "#cbd5e1" };
            case "AVAILABLE":
            default:
                return { bg: "#dcfce7", color: "#15803d", border: "#bbf7d0" };
        }
    };

    return (
        <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Vehicles</h1>
                    <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>Manage fleet vehicles, status, and driver assignments</p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    style={{
                        backgroundColor: "#047857",
                        color: "white",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        border: "none",
                        fontWeight: "600",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px"
                    }}
                >
                    <span>+</span> Add Vehicle
                </button>
            </div>

            {/* Filter bar */}
            <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "10px", marginBottom: "20px", border: "1px solid #e2e8f0" }}>
                <input
                    type="text"
                    placeholder="Search by vehicle number or driver..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        width: "320px",
                        padding: "8px 14px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        fontSize: "14px"
                    }}
                />
            </div>

            {/* Table */}
            <div style={{ backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
                    <thead>
                        <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                            <th style={{ padding: "14px 20px" }}>ID</th>
                            <th style={{ padding: "14px 20px" }}>Vehicle Number</th>
                            <th style={{ padding: "14px 20px" }}>Driver Name</th>
                            <th style={{ padding: "14px 20px" }}>Status</th>
                            <th style={{ padding: "14px 20px" }}>Stops Completed</th>
                            <th style={{ padding: "14px 20px", textAlign: "right" }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="6" style={{ padding: "20px", textAlign: "center" }}>Loading vehicles...</td></tr>
                        ) : filteredVehicles.length === 0 ? (
                            <tr><td colSpan="6" style={{ padding: "20px", textAlign: "center", color: "#64748b" }}>No vehicles found</td></tr>
                        ) : (
                            filteredVehicles.map((v) => {
                                const badge = getStatusStyle(v.status);
                                return (
                                    <tr key={v.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                        <td style={{ padding: "14px 20px", fontWeight: "600", color: "#334155" }}>V0{v.id}</td>
                                        <td style={{ padding: "14px 20px", fontWeight: "700", color: "#047857" }}>{v.vehicle_number}</td>
                                        <td style={{ padding: "14px 20px", color: "#334155" }}>{v.driver_name || "Unassigned"}</td>
                                        <td style={{ padding: "14px 20px" }}>
                                            <select
                                                value={v.status || "AVAILABLE"}
                                                onChange={(e) => handleStatusChange(v.id, e.target.value)}
                                                style={{
                                                    padding: "4px 8px",
                                                    borderRadius: "8px",
                                                    fontSize: "12px",
                                                    fontWeight: "700",
                                                    backgroundColor: badge.bg,
                                                    color: badge.color,
                                                    border: `1px solid ${badge.border}`,
                                                    cursor: "pointer"
                                                }}
                                            >
                                                <option value="AVAILABLE">AVAILABLE</option>
                                                <option value="ACTIVE">ACTIVE</option>
                                                <option value="IN_SERVICE">IN_SERVICE</option>
                                                <option value="MAINTENANCE">MAINTENANCE</option>
                                                <option value="INACTIVE">INACTIVE</option>
                                            </select>
                                        </td>
                                        <td style={{ padding: "14px 20px", color: "#334155" }}>
                                            {v.completed_stops || 0} / {v.assigned_stops || 0}
                                        </td>
                                        <td style={{ padding: "14px 20px", textAlign: "right" }}>
                                            <button
                                                onClick={() => handleViewDetails(v.id)}
                                                style={{
                                                    padding: "6px 14px",
                                                    backgroundColor: "#047857",
                                                    color: "white",
                                                    border: "none",
                                                    borderRadius: "6px",
                                                    fontSize: "12px",
                                                    fontWeight: "600",
                                                    cursor: "pointer"
                                                }}
                                            >
                                                View Details
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Add Vehicle Modal */}
            {showAddModal && (
                <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000
                }}>
                    <div style={{ backgroundColor: "white", padding: "28px", borderRadius: "12px", width: "400px" }}>
                        <h3 style={{ marginTop: 0, color: "#0f172a" }}>Add New Vehicle</h3>
                        <form onSubmit={handleAddVehicle}>
                            <div style={{ marginBottom: "16px" }}>
                                <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "6px" }}>Vehicle Number</label>
                                <input
                                    type="text"
                                    placeholder="e.g. KA06KL2345"
                                    value={newVehicleNumber}
                                    onChange={(e) => setNewVehicleNumber(e.target.value)}
                                    required
                                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                                />
                            </div>
                            <div style={{ marginBottom: "20px" }}>
                                <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "6px" }}>Initial Status</label>
                                <select
                                    value={newStatus}
                                    onChange={(e) => setNewStatus(e.target.value)}
                                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                                >
                                    <option value="AVAILABLE">Available</option>
                                    <option value="IN_SERVICE">In Service</option>
                                    <option value="MAINTENANCE">Maintenance</option>
                                </select>
                            </div>
                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                                <button type="button" onClick={() => setShowAddModal(false)} style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #cbd5e1", backgroundColor: "white", cursor: "pointer" }}>Cancel</button>
                                <button type="submit" style={{ padding: "8px 16px", borderRadius: "6px", border: "none", backgroundColor: "#047857", color: "white", cursor: "pointer", fontWeight: "600" }}>Save Vehicle</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Comprehensive Vehicle Details Modal */}
            {selectedVehicleDetails && (
                <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: "white",
                        padding: "28px",
                        borderRadius: "14px",
                        width: "720px",
                        maxWidth: "92%",
                        maxHeight: "88vh",
                        overflowY: "auto"
                    }}>
                        {/* Modal Header */}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", borderBottom: "1px solid #e2e8f0", paddingBottom: "16px" }}>
                            <div>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    <h2 style={{ margin: 0, color: "#047857", fontSize: "22px", fontWeight: "800" }}>
                                        🚛 {selectedVehicleDetails.vehicle?.vehicle_number}
                                    </h2>
                                    <span style={{
                                        backgroundColor: "#ecfdf5",
                                        color: "#047857",
                                        padding: "3px 10px",
                                        borderRadius: "12px",
                                        fontSize: "12px",
                                        fontWeight: "700"
                                    }}>
                                        {selectedVehicleDetails.vehicle?.vehicle_status || "In Service"}
                                    </span>
                                </div>
                                <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "14px" }}>
                                    Driver: <strong>{selectedVehicleDetails.vehicle?.driver_name || "Unassigned"}</strong> {selectedVehicleDetails.vehicle?.driver_phone ? `(${selectedVehicleDetails.vehicle?.driver_phone})` : ""}
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    setSelectedVehicleDetails(null);
                                    if (onClearInitialVehicle) onClearInitialVehicle();
                                }}
                                style={{ border: "none", background: "#f1f5f9", borderRadius: "50%", width: "32px", height: "32px", fontSize: "16px", cursor: "pointer" }}
                            >
                                ✕
                            </button>
                        </div>

                        {/* Summary Badges Bar */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "20px" }}>
                            <div style={{ backgroundColor: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px solid #e2e8f0", textAlign: "center" }}>
                                <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textTransform: "uppercase" }}>Total Assigned</div>
                                <div style={{ fontSize: "20px", fontWeight: "800", color: "#0f172a", marginTop: "2px" }}>
                                    {selectedVehicleDetails.summary?.total_stops || 0} Areas
                                </div>
                            </div>

                            <div style={{ backgroundColor: "#f0fdf4", padding: "12px", borderRadius: "8px", border: "1px solid #bbf7d0", textAlign: "center" }}>
                                <div style={{ fontSize: "11px", color: "#166534", fontWeight: "600", textTransform: "uppercase" }}>🟢 Collected</div>
                                <div style={{ fontSize: "20px", fontWeight: "800", color: "#15803d", marginTop: "2px" }}>
                                    {selectedVehicleDetails.summary?.completed_count || 0} Areas
                                </div>
                            </div>

                            <div style={{ backgroundColor: "#fefce8", padding: "12px", borderRadius: "8px", border: "1px solid #fef08a", textAlign: "center" }}>
                                <div style={{ fontSize: "11px", color: "#854d0e", fontWeight: "600", textTransform: "uppercase" }}>🟡 Pending</div>
                                <div style={{ fontSize: "20px", fontWeight: "800", color: "#b45309", marginTop: "2px" }}>
                                    {selectedVehicleDetails.summary?.pending_count || 0} Areas
                                </div>
                            </div>

                            <div style={{ backgroundColor: "#fef2f2", padding: "12px", borderRadius: "8px", border: "1px solid #fecaca", textAlign: "center" }}>
                                <div style={{ fontSize: "11px", color: "#991b1b", fontWeight: "600", textTransform: "uppercase" }}>🔴 Missed</div>
                                <div style={{ fontSize: "20px", fontWeight: "800", color: "#dc2626", marginTop: "2px" }}>
                                    {selectedVehicleDetails.summary?.missed_count || 0} Areas
                                </div>
                            </div>
                        </div>

                        {/* Categorized Filter Tabs */}
                        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid #e2e8f0", paddingBottom: "10px" }}>
                            <button
                                onClick={() => setDetailsTab("ALL")}
                                style={{
                                    padding: "6px 14px", borderRadius: "6px", border: "none", fontSize: "13px", fontWeight: "600", cursor: "pointer",
                                    backgroundColor: detailsTab === "ALL" ? "#047857" : "#f1f5f9",
                                    color: detailsTab === "ALL" ? "white" : "#475569"
                                }}
                            >
                                All Areas ({selectedVehicleDetails.summary?.total_stops || 0})
                            </button>
                            <button
                                onClick={() => setDetailsTab("COMPLETED")}
                                style={{
                                    padding: "6px 14px", borderRadius: "6px", border: "none", fontSize: "13px", fontWeight: "600", cursor: "pointer",
                                    backgroundColor: detailsTab === "COMPLETED" ? "#16a34a" : "#f1f5f9",
                                    color: detailsTab === "COMPLETED" ? "white" : "#475569"
                                }}
                            >
                                🟢 Collected ({selectedVehicleDetails.summary?.completed_count || 0})
                            </button>
                            <button
                                onClick={() => setDetailsTab("PENDING")}
                                style={{
                                    padding: "6px 14px", borderRadius: "6px", border: "none", fontSize: "13px", fontWeight: "600", cursor: "pointer",
                                    backgroundColor: detailsTab === "PENDING" ? "#d97706" : "#f1f5f9",
                                    color: detailsTab === "PENDING" ? "white" : "#475569"
                                }}
                            >
                                🟡 Pending ({selectedVehicleDetails.summary?.pending_count || 0})
                            </button>
                            <button
                                onClick={() => setDetailsTab("MISSED")}
                                style={{
                                    padding: "6px 14px", borderRadius: "6px", border: "none", fontSize: "13px", fontWeight: "600", cursor: "pointer",
                                    backgroundColor: detailsTab === "MISSED" ? "#dc2626" : "#f1f5f9",
                                    color: detailsTab === "MISSED" ? "white" : "#475569"
                                }}
                            >
                                🔴 Missed ({selectedVehicleDetails.summary?.missed_count || 0})
                            </button>
                        </div>

                        {/* Collection Areas List */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {selectedVehicleDetails.all_stops.length === 0 ? (
                                <p style={{ fontSize: "14px", color: "#64748b", textAlign: "center", padding: "20px" }}>
                                    No collection areas assigned to this vehicle for today.
                                </p>
                            ) : (
                                selectedVehicleDetails.all_stops
                                    .filter(stop => detailsTab === "ALL" || stop.stop_status === detailsTab)
                                    .map((stop) => {
                                        const isCompleted = stop.stop_status === "COMPLETED";
                                        const isMissed = stop.stop_status === "MISSED";

                                        return (
                                            <div
                                                key={stop.stop_id}
                                                style={{
                                                    padding: "14px",
                                                    borderRadius: "8px",
                                                    border: "1px solid",
                                                    borderColor: isCompleted ? "#bbf7d0" : isMissed ? "#fecaca" : "#fef08a",
                                                    backgroundColor: isCompleted ? "#f0fdf4" : isMissed ? "#fef2f2" : "#fefce8",
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center"
                                                }}
                                            >
                                                <div>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                        <span style={{ fontWeight: "800", color: "#1e293b", fontSize: "14px" }}>
                                                            {stop.sequence}. {stop.point_name}
                                                        </span>
                                                        <span style={{
                                                            fontSize: "11px",
                                                            padding: "2px 6px",
                                                            borderRadius: "4px",
                                                            backgroundColor: "#e2e8f0",
                                                            color: "#334155",
                                                            fontWeight: "600"
                                                        }}>
                                                            {stop.ward}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: "13px", color: "#475569", marginTop: "4px" }}>
                                                        📍 {stop.address}
                                                    </div>

                                                    {/* Additional Info depending on status */}
                                                    {isCompleted && (
                                                        <div style={{ fontSize: "12px", color: "#15803d", marginTop: "4px", fontWeight: "600" }}>
                                                            ✓ Collected at: {stop.actual_arrival ? new Date(stop.actual_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Completed"}
                                                        </div>
                                                    )}
                                                    {isMissed && (
                                                        <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "4px", fontWeight: "600" }}>
                                                            ❌ Reason: {stop.miss_reason || "Vehicle did not reach area on time"}
                                                        </div>
                                                    )}
                                                    {!isCompleted && !isMissed && (
                                                        <div style={{ fontSize: "12px", color: "#b45309", marginTop: "4px" }}>
                                                            🕐 Scheduled time: {stop.scheduled_time || "09:00 AM"} (Pending)
                                                        </div>
                                                    )}
                                                </div>

                                                <div>
                                                    <span style={{
                                                        padding: "4px 10px",
                                                        borderRadius: "12px",
                                                        fontSize: "12px",
                                                        fontWeight: "700",
                                                        backgroundColor: isCompleted ? "#dcfce7" : isMissed ? "#fee2e2" : "#fef3c7",
                                                        color: isCompleted ? "#15803d" : isMissed ? "#b91c1c" : "#b45309"
                                                    }}>
                                                        {stop.stop_status}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })
                            )}
                        </div>

                        <div style={{ marginTop: "24px", textAlign: "right" }}>
                            <button
                                onClick={() => {
                                    setSelectedVehicleDetails(null);
                                    if (onClearInitialVehicle) onClearInitialVehicle();
                                }}
                                style={{
                                    backgroundColor: "#047857",
                                    color: "white",
                                    padding: "8px 20px",
                                    borderRadius: "6px",
                                    border: "none",
                                    fontWeight: "600",
                                    cursor: "pointer"
                                }}
                            >
                                Close Details
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default VehiclesPage;
