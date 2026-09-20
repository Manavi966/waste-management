import React, { useState, useEffect } from "react";
import api from "../services/api";

function CollectionPointsPage() {
    const [points, setPoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedWard, setSelectedWard] = useState("ALL");
    const [searchTerm, setSearchTerm] = useState("");

    const fetchPoints = async () => {
        try {
            const response = await api.get("/collection-points");
            setPoints(response.data);
        } catch (error) {
            console.error("Failed to fetch collection points:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPoints();
    }, []);

    const wards = ["ALL", ...new Set(points.map(p => p.ward))];

    const filteredPoints = points.filter(p => {
        const matchesWard = selectedWard === "ALL" || p.ward === selectedWard;
        const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            p.address.toLowerCase().includes(searchTerm.toLowerCase());
        return matchesWard && matchesSearch;
    });

    return (
        <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Collection Points</h1>
                    <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>Manage municipal waste collection points and scheduled pick-up times</p>
                </div>
            </div>

            {/* Filter Bar */}
            <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "10px", marginBottom: "20px", border: "1px solid #e2e8f0", display: "flex", gap: "16px" }}>
                <input
                    type="text"
                    placeholder="Search collection point or address..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ width: "320px", padding: "8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                />

                <select
                    value={selectedWard}
                    onChange={(e) => setSelectedWard(e.target.value)}
                    style={{ padding: "8px 14px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px" }}
                >
                    {wards.map(w => (
                        <option key={w} value={w}>{w === "ALL" ? "All Wards" : w}</option>
                    ))}
                </select>
            </div>

            {/* Table */}
            <div style={{ backgroundColor: "#ffffff", borderRadius: "10px", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
                    <thead>
                        <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                            <th style={{ padding: "14px 20px" }}>ID</th>
                            <th style={{ padding: "14px 20px" }}>Name</th>
                            <th style={{ padding: "14px 20px" }}>Address</th>
                            <th style={{ padding: "14px 20px" }}>Ward</th>
                            <th style={{ padding: "14px 20px" }}>Coordinates</th>
                            <th style={{ padding: "14px 20px" }}>Scheduled Time</th>
                            <th style={{ padding: "14px 20px" }}>Assigned Vehicle</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan="7" style={{ padding: "20px", textAlign: "center" }}>Loading collection points...</td></tr>
                        ) : filteredPoints.length === 0 ? (
                            <tr><td colSpan="7" style={{ padding: "20px", textAlign: "center", color: "#64748b" }}>No collection points found</td></tr>
                        ) : (
                            filteredPoints.map((p) => (
                                <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                    <td style={{ padding: "14px 20px", fontWeight: "600", color: "#334155" }}>CP0{p.id}</td>
                                    <td style={{ padding: "14px 20px", fontWeight: "700", color: "#047857" }}>{p.name}</td>
                                    <td style={{ padding: "14px 20px", color: "#334155" }}>{p.address}</td>
                                    <td style={{ padding: "14px 20px" }}>
                                        <span style={{ backgroundColor: "#ecfdf5", color: "#047857", padding: "3px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "600" }}>
                                            {p.ward}
                                        </span>
                                    </td>
                                    <td style={{ padding: "14px 20px", color: "#64748b" }}>
                                        {Number(p.latitude).toFixed(4)}, {Number(p.longitude).toFixed(4)}
                                    </td>
                                    <td style={{ padding: "14px 20px", color: "#334155" }}>{p.scheduled_time || "09:00 AM"}</td>
                                    <td style={{ padding: "14px 20px", fontWeight: "600", color: "#1e293b" }}>
                                        {p.vehicle_number ? `🚛 ${p.vehicle_number}` : <span style={{ color: "#94a3b8" }}>Unassigned</span>}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default CollectionPointsPage;
