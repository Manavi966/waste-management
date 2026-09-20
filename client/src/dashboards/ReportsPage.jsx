import React, { useState, useEffect } from "react";
import api from "../services/api";

function ReportsPage() {
    const [reportsData, setReportsData] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchReports = async () => {
        try {
            const response = await api.get("/admin/reports");
            setReportsData(response.data);
        } catch (err) {
            console.error("Fetch reports error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReports();
    }, []);

    if (loading) return <div style={{ padding: "30px" }}>Loading Reports & Analytics...</div>;

    const metrics = reportsData?.metrics || {
        total_collections: 285,
        total_waste_tons: 142.5,
        on_time_percent: 94,
        missed_percent: 6,
        total_distance_km: 320
    };

    const wardColors = ["#047857", "#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6"];

    return (
        <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>Reports & Analytics</h1>
                    <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>System performance, collection rates, and municipal waste trends</p>
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "28px" }}>
                <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ width: "48px", height: "48px", borderRadius: "10px", backgroundColor: "#ecfdf5", color: "#047857", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>✓</div>
                    <div>
                        <div style={{ fontSize: "13px", color: "#64748b", fontWeight: "500" }}>Total Collections</div>
                        <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a" }}>{metrics.total_collections}</div>
                    </div>
                </div>

                <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ width: "48px", height: "48px", borderRadius: "10px", backgroundColor: "#eff6ff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>🗑️</div>
                    <div>
                        <div style={{ fontSize: "13px", color: "#64748b", fontWeight: "500" }}>Total Waste (Tons)</div>
                        <div style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a" }}>{metrics.total_waste_tons}</div>
                    </div>
                </div>

                <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ width: "48px", height: "48px", borderRadius: "10px", backgroundColor: "#fef3c7", color: "#d97706", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>⏱️</div>
                    <div>
                        <div style={{ fontSize: "13px", color: "#64748b", fontWeight: "500" }}>On-Time Collections</div>
                        <div style={{ fontSize: "24px", fontWeight: "800", color: "#d97706" }}>{metrics.on_time_percent}%</div>
                    </div>
                </div>

                <div style={{ backgroundColor: "#ffffff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ width: "48px", height: "48px", borderRadius: "10px", backgroundColor: "#fee2e2", color: "#dc2626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px" }}>⚠️</div>
                    <div>
                        <div style={{ fontSize: "13px", color: "#64748b", fontWeight: "500" }}>Missed Collections</div>
                        <div style={{ fontSize: "24px", fontWeight: "800", color: "#dc2626" }}>{metrics.missed_percent}%</div>
                    </div>
                </div>
            </div>

            {/* Charts Section */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "24px" }}>
                
                {/* Collection Trend */}
                <div style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", marginTop: 0, marginBottom: "20px" }}>Collection Trend</h3>
                    
                    <div style={{ display: "flex", gap: "20px", marginBottom: "16px", fontSize: "12px", fontWeight: "600" }}>
                        <span style={{ color: "#047857" }}>■ Completed Collections</span>
                        <span style={{ color: "#dc2626" }}>■ Missed Collections</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "flex-end", gap: "16px", height: "220px", paddingBottom: "20px", borderBottom: "1px solid #e2e8f0" }}>
                        {(reportsData?.collection_trend || [
                            { date_label: "Apr 1", completed: 25, missed: 2 },
                            { date_label: "Apr 4", completed: 30, missed: 1 },
                            { date_label: "Apr 7", completed: 28, missed: 3 },
                            { date_label: "Apr 10", completed: 35, missed: 0 },
                            { date_label: "Apr 14", completed: 32, missed: 2 },
                            { date_label: "Apr 18", completed: 40, missed: 1 },
                            { date_label: "Apr 21", completed: 38, missed: 2 }
                        ]).map((item, idx) => {
                            const compHeight = Math.min((item.completed / 45) * 180, 180);
                            const missHeight = Math.min((item.missed / 45) * 180, 180);
                            return (
                                <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                                    <div style={{ display: "flex", gap: "4px", alignItems: "flex-end" }}>
                                        <div style={{ width: "16px", height: `${compHeight}px`, backgroundColor: "#047857", borderRadius: "4px 4px 0 0" }} title={`Completed: ${item.completed}`}></div>
                                        <div style={{ width: "16px", height: `${missHeight || 4}px`, backgroundColor: "#dc2626", borderRadius: "4px 4px 0 0" }} title={`Missed: ${item.missed}`}></div>
                                    </div>
                                    <span style={{ fontSize: "11px", color: "#64748b", marginTop: "8px" }}>{item.date_label.slice(5)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Waste by Ward Breakdown */}
                <div style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#0f172a", marginTop: 0, marginBottom: "20px" }}>Waste by Ward</h3>

                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                        {(reportsData?.waste_by_ward || [
                            { ward: "Ward 12", count: 22 },
                            { ward: "Ward 13", count: 18 },
                            { ward: "Ward 14", count: 20 },
                            { ward: "Ward 15", count: 15 },
                            { ward: "Ward 16", count: 25 }
                        ]).map((w, idx) => {
                            const color = wardColors[idx % wardColors.length];
                            const percent = Math.round((w.count / metrics.total_collections) * 100) || (20 + idx * 2);
                            return (
                                <div key={w.ward}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "4px", fontWeight: "500" }}>
                                        <span style={{ color: "#334155" }}>{w.ward}</span>
                                        <span style={{ color: "#64748b" }}>{percent}% ({w.count} stops)</span>
                                    </div>
                                    <div style={{ width: "100%", height: "8px", backgroundColor: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
                                        <div style={{ width: `${percent}%`, height: "100%", backgroundColor: color }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
        </div>
    );
}

export default ReportsPage;
