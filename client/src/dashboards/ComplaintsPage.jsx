import React, { useState, useEffect } from "react";
import api from "../services/api";

function ComplaintsPage() {
    const [complaints, setComplaints] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("ALL");
    const [selectedCategory, setSelectedCategory] = useState("ALL");
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedComplaint, setSelectedComplaint] = useState(null);
    const [assignVehicleId, setAssignVehicleId] = useState("");
    const [assignStatus, setAssignStatus] = useState("IN_PROGRESS");

    const fetchComplaints = async () => {
        try {
            const response = await api.get("/complaints");
            setComplaints(response.data);

            const vRes = await api.get("/vehicles");
            setVehicles(vRes.data);
        } catch (err) {
            console.error("Fetch complaints error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchComplaints();
    }, []);

    const handleAssignAndUpdate = async (e) => {
        e.preventDefault();
        if (!selectedComplaint) return;
        try {
            await api.put(`/complaints/${selectedComplaint.id}/assign`, {
                vehicle_id: assignVehicleId || null,
                status: assignStatus
            });
            alert(`Complaint #${selectedComplaint.id} updated successfully.`);
            setSelectedComplaint(null);
            fetchComplaints();
        } catch (err) {
            alert(err.response?.data?.message || "Failed to update complaint");
        }
    };

    const filteredComplaints = complaints.filter(c => {
        const matchesTab = activeTab === "ALL" || c.status === activeTab;
        const matchesCategory = selectedCategory === "ALL" || c.category === selectedCategory;
        const matchesSearch = (c.description && c.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (c.citizen_name && c.citizen_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (c.location && c.location.toLowerCase().includes(searchTerm.toLowerCase()));
        return matchesTab && matchesCategory && matchesSearch;
    });

    const getStatusBadge = (status) => {
        switch (status) {
            case "RESOLVED":
                return { bg: "#dcfce7", color: "#15803d", label: "Resolved" };
            case "IN_PROGRESS":
                return { bg: "#fef3c7", color: "#b45309", label: "In Progress" };
            default:
                return { bg: "#fee2e2", color: "#b91c1c", label: "Pending" };
        }
    };

    return (
        <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ marginBottom: "24px" }}>
                <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Complaints</h1>
                <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>Manage citizen complaints and assign resolution vehicles</p>
            </div>

            {/* Filter Tabs */}
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                {["ALL", "PENDING", "IN_PROGRESS", "RESOLVED"].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            padding: "8px 16px",
                            borderRadius: "20px",
                            border: "none",
                            fontSize: "13px",
                            fontWeight: "600",
                            cursor: "pointer",
                            backgroundColor: activeTab === tab ? "#047857" : "#e2e8f0",
                            color: activeTab === tab ? "#ffffff" : "#475569"
                        }}
                    >
                        {tab === "ALL" ? `All (${complaints.length})` : `${tab.replace("_", " ")} (${complaints.filter(c => c.status === tab).length})`}
                    </button>
                ))}
            </div>

            {/* Controls Bar */}
            <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "10px", marginBottom: "20px", border: "1px solid #e2e8f0", display: "flex", gap: "16px" }}>
                <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    style={{ padding: "8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                >
                    <option value="ALL">All Types</option>
                    <option value="Missed Collection">Missed Collection</option>
                    <option value="Waste Leakage">Waste Leakage</option>
                    <option value="Overflowing Waste">Overflowing Waste</option>
                    <option value="Other">Other</option>
                </select>

                <input
                    type="text"
                    placeholder="Search complaints..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ width: "320px", padding: "8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                />
            </div>

            {/* Complaints Table */}
            <div style={{ backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
                    <thead>
                        <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                            <th style={{ padding: "14px 20px" }}>ID</th>
                            <th style={{ padding: "14px 20px" }}>Citizen Name</th>
                            <th style={{ padding: "14px 20px" }}>Location</th>
                            <th style={{ padding: "14px 20px" }}>Type</th>
                            <th style={{ padding: "14px 20px" }}>Date</th>
                            <th style={{ padding: "14px 20px" }}>Status</th>
                            <th style={{ padding: "14px 20px", textAlign: "right" }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="7" style={{ padding: "20px", textAlign: "center" }}>Loading complaints...</td></tr>
                        ) : filteredComplaints.length === 0 ? (
                            <tr><td colSpan="7" style={{ padding: "20px", textAlign: "center", color: "#64748b" }}>No complaints found</td></tr>
                        ) : (
                            filteredComplaints.map((c) => {
                                const badge = getStatusBadge(c.status);
                                return (
                                    <tr key={c.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                        <td style={{ padding: "14px 20px", fontWeight: "600", color: "#334155" }}>C00{c.id}</td>
                                        <td style={{ padding: "14px 20px", fontWeight: "600", color: "#1e293b" }}>{c.citizen_name || "Priya Sharma"}</td>
                                        <td style={{ padding: "14px 20px", color: "#475569" }}>{c.location || "Green Park"}</td>
                                        <td style={{ padding: "14px 20px", color: "#047857", fontWeight: "600" }}>{c.category}</td>
                                        <td style={{ padding: "14px 20px", color: "#64748b" }}>{new Date(c.created_at).toLocaleDateString()}</td>
                                        <td style={{ padding: "14px 20px" }}>
                                            <span style={{ backgroundColor: badge.bg, color: badge.color, padding: "4px 10px", borderRadius: "12px", fontSize: "12px", fontWeight: "600" }}>
                                                {badge.label}
                                            </span>
                                        </td>
                                        <td style={{ padding: "14px 20px", textAlign: "right" }}>
                                            <button
                                                onClick={() => {
                                                    setSelectedComplaint(c);
                                                    setAssignVehicleId(c.assigned_vehicle_id ? c.assigned_vehicle_id.toString() : "");
                                                    setAssignStatus(c.status);
                                                }}
                                                style={{
                                                    padding: "6px 14px",
                                                    backgroundColor: c.status === "PENDING" ? "#047857" : "#f1f5f9",
                                                    color: c.status === "PENDING" ? "white" : "#334155",
                                                    border: "none",
                                                    borderRadius: "6px",
                                                    fontSize: "12px",
                                                    fontWeight: "600",
                                                    cursor: "pointer"
                                                }}
                                            >
                                                {c.status === "PENDING" ? "Assign" : "View"}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Complaint Detail Action Modal / Drawer */}
            {selectedComplaint && (
                <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000
                }}>
                    <div style={{ backgroundColor: "white", padding: "32px", borderRadius: "12px", width: "500px", maxWidth: "90%" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <h3 style={{ margin: 0, color: "#0f172a", fontSize: "20px" }}>
                                C00{selectedComplaint.id} - {selectedComplaint.category}
                            </h3>
                            <button onClick={() => setSelectedComplaint(null)} style={{ border: "none", background: "none", fontSize: "18px", cursor: "pointer" }}>✕</button>
                        </div>

                        <div style={{ backgroundColor: "#f8fafc", padding: "16px", borderRadius: "8px", marginBottom: "20px" }}>
                            <p style={{ margin: "0 0 8px 0", fontSize: "14px" }}><strong>Citizen Name:</strong> {selectedComplaint.citizen_name || "Priya Sharma"}</p>
                            <p style={{ margin: "0 0 8px 0", fontSize: "14px" }}><strong>Location:</strong> {selectedComplaint.location || "Green Park Collection Point"}</p>
                            <p style={{ margin: "0 0 8px 0", fontSize: "14px" }}><strong>Type:</strong> {selectedComplaint.category}</p>
                            <p style={{ margin: 0, fontSize: "14px", color: "#475569" }}><strong>Description:</strong> {selectedComplaint.description}</p>
                        </div>

                        <form onSubmit={handleAssignAndUpdate}>
                            <h4 style={{ margin: "0 0 12px 0", color: "#047857" }}>Take Action</h4>

                            <div style={{ marginBottom: "16px" }}>
                                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>Assign to Vehicle</label>
                                <select
                                    value={assignVehicleId}
                                    onChange={(e) => setAssignVehicleId(e.target.value)}
                                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                                >
                                    <option value="">Select Vehicle</option>
                                    {vehicles.map(v => (
                                        <option key={v.id} value={v.id}>V-0{v.id} ({v.vehicle_number})</option>
                                    ))}
                                </select>
                            </div>

                            <div style={{ marginBottom: "24px" }}>
                                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", marginBottom: "6px" }}>Update Status</label>
                                <select
                                    value={assignStatus}
                                    onChange={(e) => setAssignStatus(e.target.value)}
                                    style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1" }}
                                >
                                    <option value="PENDING">Pending</option>
                                    <option value="IN_PROGRESS">In Progress</option>
                                    <option value="RESOLVED">Resolved</option>
                                </select>
                            </div>

                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                                <button type="button" onClick={() => setSelectedComplaint(null)} style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #cbd5e1", backgroundColor: "white", cursor: "pointer" }}>Close</button>
                                <button type="submit" style={{ padding: "8px 20px", borderRadius: "6px", border: "none", backgroundColor: "#047857", color: "white", fontWeight: "600", cursor: "pointer" }}>Save Action</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ComplaintsPage;
