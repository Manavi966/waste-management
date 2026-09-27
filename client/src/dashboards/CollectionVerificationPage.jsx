import React, { useState, useEffect, useRef } from "react";
import api from "../services/api";
import CheckpointQRCodesViewModal from "../components/CheckpointQRCodesViewModal";

function CollectionVerificationPage({ selectedDate, setSelectedDate }) {
    const [verificationData, setVerificationData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedWard, setSelectedWard] = useState("ALL");
    const [selectedZoneCheckpoints, setSelectedZoneCheckpoints] = useState(null);
    const [qrModalZone, setQrModalZone] = useState(null);
    const [demoDuration, setDemoDuration] = useState("30");
    const [updatingConfig, setUpdatingConfig] = useState(false);
    const [configMsg, setConfigMsg] = useState("");

    const fetchVerificationData = async () => {
        try {
            const wardQuery = selectedWard !== "ALL" ? `&ward=${selectedWard}` : "";
            const res = await api.get(`/admin/collection-verification?date=${selectedDate}${wardQuery}`);
            setVerificationData(res.data);
            setError("");
        } catch (err) {
            console.error("Failed to load verification data:", err);
            setError("Failed to fetch live collection verification data.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchVerificationData();
        const interval = setInterval(fetchVerificationData, 5000);
        return () => clearInterval(interval);
    }, [selectedDate, selectedWard]);

    const handleUpdateConfigDuration = async (seconds) => {
        try {
            setUpdatingConfig(true);
            setConfigMsg("");
            const res = await api.patch("/admin/config/collection-time", { seconds: Number(seconds) });
            setDemoDuration(seconds.toString());
            setConfigMsg(res.data.message || `Minimum dwell time updated to ${seconds}s.`);
            fetchVerificationData();
        } catch (err) {
            console.error("Failed to update dwell duration:", err);
            setConfigMsg("Failed to update duration.");
        } finally {
            setUpdatingConfig(false);
        }
    };

    const getStatusBadge = (status) => {
        switch (status) {
            case "COMPLETED":
                return <span style={{ backgroundColor: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>🟢 COMPLETED</span>;
            case "READY_FOR_COMPLETION":
                return <span style={{ backgroundColor: "#e0f2fe", color: "#0369a1", border: "1px solid #bae6fd", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>⭐ READY TO COMPLETE</span>;
            case "IN_PROGRESS":
                return <span style={{ backgroundColor: "#fef3c7", color: "#b45309", border: "1px solid #fde68a", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>⏳ IN PROGRESS</span>;
            case "DWELL_RESET":
                return <span style={{ backgroundColor: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>⚠️ DWELL RESET</span>;
            case "MISSED":
                return <span style={{ backgroundColor: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "800" }}>🔴 MISSED</span>;
            default:
                return <span style={{ backgroundColor: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0", padding: "4px 10px", borderRadius: "12px", fontSize: "11px", fontWeight: "700" }}>⚪ NOT STARTED</span>;
        }
    };

    const zones = verificationData?.zones || [];

    return (
        <div style={{ padding: "24px", maxWidth: "1300px", margin: "0 auto" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "16px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                        Collection Verification & Dwell Monitoring
                    </h1>
                    <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>
                        Multi-factor collection zone verification: GPS Geofence (100m) + Minimum Dwell Time + Representative Scanner Checkpoints.
                    </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", backgroundColor: "white", padding: "6px 14px", borderRadius: "8px", border: "1px solid #cbd5e1" }}>
                        <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>📅 Operation Date:</span>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            style={{ border: "1px solid #94a3b8", borderRadius: "6px", padding: "4px 8px", fontSize: "13px", fontWeight: "700" }}
                        />
                    </div>
                </div>
            </div>

            {/* DEMO CONFIGURATION PANEL */}
            <div style={{
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 20px",
                marginBottom: "24px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "16px"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "22px" }}>⏱️</span>
                    <div>
                        <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>
                            Collection Dwell Time Configuration
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>
                            Configurable minimum time the vehicle must dwell inside the geofence before collection can be verified.
                        </div>
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>Set Duration:</span>
                    {[
                        { label: "15s (Quick Demo)", val: "15" },
                        { label: "30s (Default Demo)", val: "30" },
                        { label: "60s (1 min)", val: "60" },
                        { label: "180s (3 min Real-World)", val: "180" },
                        { label: "240s (4 min Real-World)", val: "240" }
                    ].map((opt) => (
                        <button
                            key={opt.val}
                            onClick={() => handleUpdateConfigDuration(opt.val)}
                            disabled={updatingConfig}
                            style={{
                                backgroundColor: demoDuration === opt.val ? "#047857" : "#ffffff",
                                color: demoDuration === opt.val ? "#ffffff" : "#334155",
                                border: `1px solid ${demoDuration === opt.val ? "#047857" : "#cbd5e1"}`,
                                padding: "6px 12px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor: "pointer",
                                boxShadow: demoDuration === opt.val ? "0 2px 4px rgba(4,120,87,0.2)" : "none"
                            }}
                        >
                            {opt.label}
                        </button>
                    ))}
                    {configMsg && (
                        <span style={{ fontSize: "12px", color: "#15803d", fontWeight: "700", marginLeft: "6px" }}>
                            ✓ {configMsg}
                        </span>
                    )}
                </div>
            </div>

            {/* KPI STATS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
                <div style={{ backgroundColor: "white", padding: "16px 20px", borderRadius: "10px", border: "1px solid #e2e8f0", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>Total Collection Zones</div>
                    <div style={{ fontSize: "28px", fontWeight: "900", color: "#0f172a", marginTop: "4px" }}>{verificationData?.total_zones || 0}</div>
                </div>

                <div style={{ backgroundColor: "white", padding: "16px 20px", borderRadius: "10px", border: "1px solid #bbf7d0", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
                    <div style={{ fontSize: "12px", color: "#166534", fontWeight: "700", textTransform: "uppercase" }}>Fully Verified & Completed</div>
                    <div style={{ fontSize: "28px", fontWeight: "900", color: "#15803d", marginTop: "4px" }}>{verificationData?.completed_zones || 0}</div>
                </div>

                <div style={{ backgroundColor: "white", padding: "16px 20px", borderRadius: "10px", border: "1px solid #fde68a", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
                    <div style={{ fontSize: "12px", color: "#92400e", fontWeight: "700", textTransform: "uppercase" }}>In Progress / Dwelling</div>
                    <div style={{ fontSize: "28px", fontWeight: "900", color: "#b45309", marginTop: "4px" }}>{verificationData?.in_progress_zones || 0}</div>
                </div>

                <div style={{ backgroundColor: "white", padding: "16px 20px", borderRadius: "10px", border: "1px solid #e2e8f0", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
                    <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>Not Started</div>
                    <div style={{ fontSize: "28px", fontWeight: "900", color: "#475569", marginTop: "4px" }}>{verificationData?.not_started_zones || 0}</div>
                </div>
            </div>

            {/* FILTER BAR */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: "#334155" }}>Filter by Ward:</span>
                    {["ALL", "Ward 12", "Ward 13", "Ward 14", "Ward 15", "Ward 16"].map(w => (
                        <button
                            key={w}
                            onClick={() => setSelectedWard(w)}
                            style={{
                                backgroundColor: selectedWard === w ? "#047857" : "#ffffff",
                                color: selectedWard === w ? "#ffffff" : "#475569",
                                border: "1px solid #cbd5e1",
                                padding: "5px 12px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor: "pointer"
                            }}
                        >
                            {w}
                        </button>
                    ))}
                </div>

                <div style={{ fontSize: "12px", color: "#64748b" }}>
                    🔄 Auto-refreshing live verification data every 5s
                </div>
            </div>

            {/* VERIFICATION TABLE */}
            <div style={{ backgroundColor: "white", borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 2px 6px rgba(0,0,0,0.04)", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                    <thead>
                        <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569", fontWeight: "700" }}>
                            <th style={{ padding: "12px 16px" }}>Collection Zone</th>
                            <th style={{ padding: "12px 16px" }}>Area / Ward</th>
                            <th style={{ padding: "12px 16px" }}>Assigned Vehicle</th>
                            <th style={{ padding: "12px 16px" }}>Scanner Progress</th>
                            <th style={{ padding: "12px 16px" }}>Dwell Duration</th>
                            <th style={{ padding: "12px 16px" }}>GPS Geofence (100m)</th>
                            <th style={{ padding: "12px 16px" }}>Status</th>
                            <th style={{ padding: "12px 16px", textAlign: "right" }}>Checkpoints</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && zones.length === 0 ? (
                            <tr>
                                <td colSpan="8" style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                                    Loading live collection verification data...
                                </td>
                            </tr>
                        ) : zones.length === 0 ? (
                            <tr>
                                <td colSpan="8" style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                                    No collection zones found for selected ward and date.
                                </td>
                            </tr>
                        ) : (
                            zones.map((z) => {
                                const isAllScanned = z.scanned_count >= z.total_scanners;
                                const isDwellMet = z.elapsed_dwell_seconds >= z.minimum_collection_time_seconds;

                                return (
                                    <tr key={z.zone_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                        <td style={{ padding: "12px 16px", fontWeight: "700", color: "#0f172a" }}>
                                            📍 {z.zone_name}
                                            <div style={{ fontSize: "11px", color: "#64748b", fontWeight: "400" }}>{z.address}</div>
                                        </td>
                                        <td style={{ padding: "12px 16px", color: "#0284c7", fontWeight: "700" }}>
                                            {z.ward}
                                        </td>
                                        <td style={{ padding: "12px 16px" }}>
                                            {z.vehicle_number ? (
                                                <div>
                                                    <span style={{ fontWeight: "700", color: "#047857" }}>{z.vehicle_number}</span>
                                                    <div style={{ fontSize: "11px", color: "#64748b" }}>Driver: {z.driver_name || "Unassigned"}</div>
                                                </div>
                                            ) : (
                                                <span style={{ color: "#94a3b8", fontStyle: "italic" }}>Unassigned</span>
                                            )}
                                        </td>
                                        <td style={{ padding: "12px 16px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                                <span style={{
                                                    fontWeight: "800",
                                                    color: isAllScanned ? "#15803d" : z.scanned_count > 0 ? "#b45309" : "#64748b"
                                                }}>
                                                    {z.scanner_progress}
                                                </span>
                                                <div style={{ width: "60px", height: "6px", backgroundColor: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
                                                    <div style={{
                                                        width: `${(z.scanned_count / z.total_scanners) * 100}%`,
                                                        height: "100%",
                                                        backgroundColor: isAllScanned ? "#16a34a" : "#f59e0b"
                                                    }} />
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: "12px 16px" }}>
                                            <div style={{ fontWeight: "700", color: isDwellMet ? "#15803d" : z.elapsed_dwell_seconds > 0 ? "#b45309" : "#64748b" }}>
                                                ⏱️ {z.dwell_formatted}
                                            </div>
                                        </td>
                                        <td style={{ padding: "12px 16px" }}>
                                            {z.distance_meters !== null ? (
                                                <span style={{
                                                    padding: "3px 8px",
                                                    borderRadius: "6px",
                                                    fontSize: "11px",
                                                    fontWeight: "700",
                                                    backgroundColor: z.is_inside_geofence ? "#dcfce7" : "#fee2e2",
                                                    color: z.is_inside_geofence ? "#15803d" : "#b91c1c"
                                                }}>
                                                    {z.is_inside_geofence ? `🟢 Inside (${z.distance_meters}m)` : `🔴 Outside (${z.distance_meters}m)`}
                                                </span>
                                            ) : (
                                                <span style={{ color: "#94a3b8", fontSize: "11px" }}>No GPS broadcast</span>
                                            )}
                                        </td>
                                        <td style={{ padding: "12px 16px" }}>
                                            {getStatusBadge(z.zone_status)}
                                        </td>
                                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                                            <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                                                <button
                                                    onClick={() => setSelectedZoneCheckpoints(z)}
                                                    style={{
                                                        backgroundColor: "#f8fafc",
                                                        border: "1px solid #cbd5e1",
                                                        padding: "5px 10px",
                                                        borderRadius: "6px",
                                                        fontSize: "11px",
                                                        fontWeight: "700",
                                                        cursor: "pointer",
                                                        color: "#334155"
                                                    }}
                                                >
                                                    🔍 Status ({z.checkpoints.length})
                                                </button>
                                                <button
                                                    onClick={() => setQrModalZone(z)}
                                                    style={{
                                                        backgroundColor: "#0f172a",
                                                        border: "1px solid #334155",
                                                        padding: "5px 10px",
                                                        borderRadius: "6px",
                                                        fontSize: "11px",
                                                        fontWeight: "700",
                                                        cursor: "pointer",
                                                        color: "#38bdf8"
                                                    }}
                                                >
                                                    🏷️ Print QRs
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* PHYSICAL QR CODES PRINTABLE MODAL FOR AUTHORITIES */}
            <CheckpointQRCodesViewModal
                isOpen={!!qrModalZone}
                onClose={() => setQrModalZone(null)}
                stop={qrModalZone}
            />

            {/* CHECKPOINT DETAILS MODAL */}
            {selectedZoneCheckpoints && (
                <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                    padding: "20px"
                }}>
                    <div style={{
                        backgroundColor: "white",
                        borderRadius: "14px",
                        maxWidth: "560px",
                        width: "100%",
                        padding: "24px",
                        boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <div>
                                <h3 style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                                    📍 {selectedZoneCheckpoints.zone_name} Checkpoints
                                </h3>
                                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                                    {selectedZoneCheckpoints.ward} • {selectedZoneCheckpoints.total_scanners} Checkpoint Scanners • Min Dwell: {selectedZoneCheckpoints.minimum_collection_time_seconds}s
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedZoneCheckpoints(null)}
                                style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: "#64748b" }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "360px", overflowY: "auto" }}>
                            {selectedZoneCheckpoints.checkpoints.map((cp, idx) => (
                                <div
                                    key={cp.id}
                                    style={{
                                        padding: "12px 14px",
                                        borderRadius: "8px",
                                        backgroundColor: cp.is_scanned ? "#f0fdf4" : "#f8fafc",
                                        border: `1px solid ${cp.is_scanned ? "#bbf7d0" : "#e2e8f0"}`,
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center"
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: "700", fontSize: "13px", color: "#0f172a" }}>
                                            {idx + 1}. {cp.name}
                                        </div>
                                        <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px", fontFamily: "monospace" }}>
                                            Code: {cp.scanner_code}
                                        </div>
                                    </div>

                                    <div>
                                        {cp.is_scanned ? (
                                            <span style={{ backgroundColor: "#dcfce7", color: "#15803d", padding: "4px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "800" }}>
                                                ✅ Scanned ({new Date(cp.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                                            </span>
                                        ) : (
                                            <span style={{ backgroundColor: "#f1f5f9", color: "#64748b", padding: "4px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>
                                                ⏳ Pending
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end" }}>
                            <button
                                onClick={() => setSelectedZoneCheckpoints(null)}
                                style={{ backgroundColor: "#047857", color: "white", padding: "8px 18px", borderRadius: "6px", border: "none", fontWeight: "700", cursor: "pointer" }}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default CollectionVerificationPage;
