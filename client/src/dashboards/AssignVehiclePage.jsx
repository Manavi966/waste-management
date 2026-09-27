import React, { useState, useEffect } from "react";
import api from "../services/api";

function AssignVehiclePage({ selectedDate: propSelectedDate, setSelectedDate: propSetSelectedDate }) {
    const [wardData, setWardData] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [eligibleReplacements, setEligibleReplacements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState({ text: "", isError: false, type: "success" });

    // Operation Date state synchronized with Authority Dashboard
    const [localSelectedDate, setLocalSelectedDate] = useState(() => {
        return propSelectedDate || localStorage.getItem("authority_operation_date") || "2026-09-20";
    });
    const selectedDate = propSelectedDate || localSelectedDate;
    const setSelectedDate = (newDate) => {
        if (propSetSelectedDate) {
            propSetSelectedDate(newDate);
        }
        setLocalSelectedDate(newDate);
        localStorage.setItem("authority_operation_date", newDate);
    };

    // Modal 1: Permanent Assignment Setup Modal State
    const [showPermanentModal, setShowPermanentModal] = useState(false);
    const [selectedWardForPerm, setSelectedWardForPerm] = useState("");
    const [selectedVehForPerm, setSelectedVehForPerm] = useState("");

    // Modal 2: Temporary Replacement Modal State (Maintenance only)
    const [showReplacementModal, setShowReplacementModal] = useState(false);
    const [maintWardInfo, setMaintWardInfo] = useState(null);
    const [selectedReplacementVehId, setSelectedReplacementVehId] = useState("");

    // Robust function to load all areas, collection points, and vehicles from database
    const loadWardOverview = async (dateToUse = selectedDate) => {
        setLoading(true);
        try {
            // Load ward overview and also fallback-fetch vehicles & areas to guarantee full dataset
            const [overviewRes, vehiclesRes, pointsRes] = await Promise.all([
                api.get(`/admin/ward-overview?date=${dateToUse}`).catch(() => ({ data: null })),
                api.get(`/vehicles?date=${dateToUse}`).catch(() => ({ data: [] })),
                api.get(`/collection-points`).catch(() => ({ data: [] }))
            ]);

            let loadedWards = overviewRes?.data?.wards || [];
            let loadedVehicles = overviewRes?.data?.vehicles || vehiclesRes?.data || [];
            let loadedReplacements = overviewRes?.data?.eligible_replacements || [];

            // If overview wards were empty, construct from collection points and assignments
            if (loadedWards.length === 0 && pointsRes.data && pointsRes.data.length > 0) {
                const points = pointsRes.data;
                const distinctWards = Array.from(new Set(points.map(p => p.ward).filter(Boolean))).sort();
                
                loadedWards = distinctWards.map(wardName => {
                    const wardPoints = points.filter(p => p.ward === wardName);
                    const matchingVeh = loadedVehicles.find(v => v.permanent_ward === wardName);
                    return {
                        ward: wardName,
                        collection_points: wardPoints,
                        total_points: wardPoints.length,
                        permanent_vehicle: matchingVeh ? {
                            vehicle_id: matchingVeh.id,
                            vehicle_number: matchingVeh.vehicle_number,
                            vehicle_status: matchingVeh.status,
                            driver_name: matchingVeh.driver_name,
                            driver_phone: matchingVeh.driver_phone
                        } : null,
                        temporary_vehicle: null,
                        is_maintenance: matchingVeh ? (matchingVeh.status === "MAINTENANCE" || matchingVeh.status === "INACTIVE") : false,
                        has_replacement: false,
                        operating_status: "NORMAL"
                    };
                });
            }

            if (loadedVehicles.length === 0 && vehiclesRes.data) {
                loadedVehicles = vehiclesRes.data;
            }

            if (loadedReplacements.length === 0 && loadedVehicles.length > 0) {
                loadedReplacements = loadedVehicles.filter(v => v.status !== "MAINTENANCE" && v.status !== "INACTIVE" && v.status !== "OUT_OF_SERVICE");
            }

            setWardData(loadedWards);
            setVehicles(loadedVehicles);
            setEligibleReplacements(loadedReplacements);
        } catch (err) {
            console.error("Failed to load ward overview:", err);
            setMessage({
                text: "Failed to load permanent area assignments and ward details.",
                isError: true,
                type: "error"
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadWardOverview(selectedDate);

        const handleUpdate = () => {
            const storedDate = localStorage.getItem("authority_operation_date") || selectedDate;
            loadWardOverview(storedDate);
        };

        window.addEventListener("focus", handleUpdate);
        window.addEventListener("vehicle_assignment_updated", handleUpdate);
        window.addEventListener("storage", handleUpdate);

        return () => {
            window.removeEventListener("focus", handleUpdate);
            window.removeEventListener("vehicle_assignment_updated", handleUpdate);
            window.removeEventListener("storage", handleUpdate);
        };
    }, [selectedDate]);

    // Open Permanent Modal for a specific ward
    // Open Permanent Modal for a specific ward or vehicle
    const openPermanentModal = (wardName = "", currentVehId = "") => {
        let vehIdStr = currentVehId ? currentVehId.toString() : "";
        let wardStr = wardName;

        if (!vehIdStr && wardStr) {
            const matchingWard = wardData.find(w => w.ward === wardStr);
            if (matchingWard?.permanent_vehicle) {
                vehIdStr = (matchingWard.permanent_vehicle.vehicle_id || matchingWard.permanent_vehicle.id || "").toString();
            }
        }

        if (vehIdStr && !wardStr) {
            const matchingVeh = vehicles.find(v => v.id.toString() === vehIdStr);
            wardStr = matchingVeh?.permanent_ward || wardData.find(w => w.permanent_vehicle?.vehicle_id?.toString() === vehIdStr)?.ward || "";
        }

        setSelectedVehForPerm(vehIdStr);
        setSelectedWardForPerm(wardStr);
        setShowPermanentModal(true);
    };

    // When vehicle changes in the modal, update selected ward to its current assignment (or reset if unassigned)
    const handleModalVehChange = (vehId) => {
        setSelectedVehForPerm(vehId);
        if (!vehId) {
            setSelectedWardForPerm("");
            return;
        }
        const matchingVeh = vehicles.find(v => v.id.toString() === vehId.toString());
        const currentWard = matchingVeh?.permanent_ward || wardData.find(w => w.permanent_vehicle?.vehicle_id?.toString() === vehId.toString())?.ward || "";
        setSelectedWardForPerm(currentWard);
    };

    // Open Temporary Replacement Modal
    const openReplacementModal = (wardItem) => {
        setMaintWardInfo(wardItem);
        setSelectedReplacementVehId("");
        setShowReplacementModal(true);
    };

    // Handle Permanent Vehicle Assignment (Initial Setup / Reconfiguration)
    const handleSavePermanentAssignment = async (e) => {
        e.preventDefault();
        if (!selectedVehForPerm) {
            setMessage({ text: "Please select a Vehicle.", isError: true, type: "error" });
            return;
        }

        if (!selectedWardForPerm) {
            setMessage({ text: "Please select a Target Area / Ward.", isError: true, type: "error" });
            return;
        }

        // Validate vehicle is not in MAINTENANCE
        const chosenVeh = vehicles.find(v => v.id.toString() === selectedVehForPerm.toString());
        if (chosenVeh && (chosenVeh.status === "MAINTENANCE" || chosenVeh.status === "INACTIVE" || chosenVeh.status === "OUT_OF_SERVICE")) {
            setMessage({
                text: `Vehicle ${chosenVeh.vehicle_number} is currently under ${chosenVeh.status} and cannot be assigned as a permanent vehicle.`,
                isError: true,
                type: "error"
            });
            return;
        }

        setSubmitting(true);
        try {
            const res = await api.post("/admin/set-permanent-area", {
                vehicle_id: Number(selectedVehForPerm),
                ward: selectedWardForPerm
            });

            const vehicleNum = chosenVeh?.vehicle_number || res.data?.vehicle_number || "Vehicle";
            setMessage({
                text: res.data.message || `${vehicleNum} is now permanently assigned to ${selectedWardForPerm}.`,
                isError: false,
                type: "success"
            });
            setShowPermanentModal(false);
            await loadWardOverview(selectedDate);
            window.dispatchEvent(new CustomEvent("vehicle_assignment_updated", { detail: { date: selectedDate } }));
        } catch (err) {
            console.error("Permanent assignment error:", err);
            setMessage({
                text: err.response?.data?.message || err.message || "Failed to save permanent assignment.",
                isError: true,
                type: "error"
            });
        } finally {
            setSubmitting(false);
        }
    };

    // Handle Assigning Temporary Replacement (Authority action during Maintenance)
    const handleSaveReplacement = async (e) => {
        e.preventDefault();
        if (!maintWardInfo || !selectedReplacementVehId) {
            setMessage({ text: "Please select a replacement vehicle.", isError: true, type: "error" });
            return;
        }

        setSubmitting(true);
        try {
            const res = await api.post("/admin/assign-replacement", {
                maintenance_vehicle_id: maintWardInfo.permanent_vehicle?.vehicle_id || maintWardInfo.permanent_vehicle?.id,
                replacement_vehicle_id: Number(selectedReplacementVehId),
                ward: maintWardInfo.ward,
                start_date: selectedDate
            });

            setMessage({
                text: res.data.message || `Temporary replacement vehicle assigned to ${maintWardInfo.ward}.`,
                isError: false,
                type: "success"
            });
            setShowReplacementModal(false);
            await loadWardOverview(selectedDate);
            window.dispatchEvent(new CustomEvent("vehicle_assignment_updated", { detail: { date: selectedDate } }));
        } catch (err) {
            console.error("Replacement assignment error:", err);
            setMessage({
                text: err.response?.data?.message || "Failed to assign replacement vehicle.",
                isError: true,
                type: "error"
            });
        } finally {
            setSubmitting(false);
        }
    };

    // Handle Ending Temporary Replacement
    const handleRemoveReplacement = async (wardName) => {
        if (!window.confirm(`End temporary replacement for ${wardName} and restore regular vehicle?`)) return;

        setSubmitting(true);
        try {
            const res = await api.post("/admin/remove-replacement", { ward: wardName });
            setMessage({
                text: res.data.message || `Temporary replacement ended. Regular assignment restored for ${wardName}.`,
                isError: false,
                type: "success"
            });
            await loadWardOverview(selectedDate);
            window.dispatchEvent(new CustomEvent("vehicle_assignment_updated", { detail: { date: selectedDate } }));
        } catch (err) {
            console.error("Remove replacement error:", err);
            setMessage({
                text: err.response?.data?.message || "Failed to end temporary replacement.",
                isError: true,
                type: "error"
            });
        } finally {
            setSubmitting(false);
        }
    };

    // Helper to get collection points of currently selected ward inside modal
    const selectedWardPoints = selectedWardForPerm
        ? (wardData.find(w => w.ward === selectedWardForPerm)?.collection_points || [])
        : [];

    return (
        <div style={{ padding: "24px", maxWidth: "1300px", margin: "0 auto" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "16px" }}>
                <div>
                    <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                        Permanent Vehicle-to-Area Assignment
                    </h1>
                    <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0", maxWidth: "800px" }}>
                        Each vehicle is permanently mapped to its designated service area/ward. All fixed collection points within that ward are automatically assigned and TSP-optimized for daily operations. Daily manual point allocation is not required.
                    </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "white", padding: "8px 14px", borderRadius: "10px", border: "1px solid #cbd5e1" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#475569" }}>📅 Operation Date:</span>
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        style={{ border: "1px solid #94a3b8", borderRadius: "6px", padding: "4px 8px", fontSize: "13px", fontWeight: "700", color: "#0f172a" }}
                    />
                </div>
            </div>

            {/* Notification Banner */}
            {message.text && (
                <div style={{
                    padding: "14px 18px",
                    borderRadius: "10px",
                    marginBottom: "20px",
                    fontWeight: "600",
                    fontSize: "14px",
                    backgroundColor: message.isError ? "#fef2f2" : "#f0fdf4",
                    color: message.isError ? "#dc2626" : "#15803d",
                    border: `1px solid ${message.isError ? "#fecaca" : "#bbf7d0"}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                }}>
                    <span>{message.isError ? "⚠️" : "✓"} {message.text}</span>
                    <button
                        onClick={() => setMessage({ text: "", isError: false, type: "success" })}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", fontWeight: "700" }}
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* Architecture Explanatory Infobox */}
            <div style={{
                backgroundColor: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "12px",
                padding: "16px 20px",
                marginBottom: "24px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "24px" }}>🔄</span>
                    <div>
                        <div style={{ fontSize: "14px", fontWeight: "700", color: "#166534" }}>
                            Automated Daily Waste Operations
                        </div>
                        <div style={{ fontSize: "13px", color: "#15803d", marginTop: "2px" }}>
                            <strong>Permanent Model:</strong> Vehicle → Permanent Area/Ward. All assignments persist indefinitely across all dates unless explicitly changed.
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => openPermanentModal("")}
                    style={{
                        backgroundColor: "#047857",
                        color: "white",
                        padding: "9px 16px",
                        borderRadius: "8px",
                        border: "none",
                        fontWeight: "700",
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        boxShadow: "0 2px 4px rgba(4,120,87,0.2)"
                    }}
                >
                    <span>➕</span>
                    <span>Assign / Change Permanent Area</span>
                </button>
            </div>

            {/* FLEET PERMANENT VEHICLE ASSIGNMENTS TABLE */}
            <div style={{ backgroundColor: "white", borderRadius: "14px", border: "1px solid #e2e8f0", boxShadow: "0 2px 6px rgba(0,0,0,0.04)", overflow: "hidden", marginBottom: "28px" }}>
                <div style={{ padding: "16px 20px", backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                    <div>
                        <h2 style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                            Fleet Permanent Area Assignments
                        </h2>
                        <span style={{ fontSize: "12px", color: "#64748b" }}>
                            Stored permanently in the database and automatically applied across all future dates.
                        </span>
                    </div>
                </div>
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
                        <thead>
                            <tr style={{ backgroundColor: "#f1f5f9", borderBottom: "1px solid #e2e8f0", color: "#475569", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                <th style={{ padding: "12px 18px" }}>Vehicle</th>
                                <th style={{ padding: "12px 18px" }}>Driver</th>
                                <th style={{ padding: "12px 18px" }}>Permanent Area</th>
                                <th style={{ padding: "12px 18px" }}>Status</th>
                                <th style={{ padding: "12px 18px", textAlign: "right" }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {vehicles.map(v => {
                                const isAssigned = Boolean(v.permanent_ward);
                                return (
                                    <tr key={v.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                                        <td style={{ padding: "14px 18px", fontWeight: "800", color: "#047857" }}>
                                            🚛 {v.vehicle_number}
                                        </td>
                                        <td style={{ padding: "14px 18px", color: "#334155" }}>
                                            {v.driver_name || "Unassigned"}
                                        </td>
                                        <td style={{ padding: "14px 18px" }}>
                                            {isAssigned ? (
                                                <span style={{ fontWeight: "800", color: "#0284c7" }}>
                                                    📍 {v.permanent_ward}
                                                </span>
                                            ) : (
                                                <span style={{ color: "#dc2626", fontStyle: "italic", fontWeight: "700" }}>
                                                    Not Assigned
                                                </span>
                                            )}
                                            {v.temporary_ward && (
                                                <div style={{ fontSize: "11px", color: "#d97706", fontWeight: "700", marginTop: "2px" }}>
                                                    ⚡ Temp: {v.temporary_ward}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: "14px 18px" }}>
                                            <span style={{
                                                padding: "3px 10px",
                                                borderRadius: "12px",
                                                fontSize: "11px",
                                                fontWeight: "800",
                                                backgroundColor: v.status === "MAINTENANCE" ? "#fee2e2" : v.status === "IN_SERVICE" ? "#dbeafe" : "#dcfce7",
                                                color: v.status === "MAINTENANCE" ? "#b91c1c" : v.status === "IN_SERVICE" ? "#1d4ed8" : "#15803d",
                                                border: `1px solid ${v.status === "MAINTENANCE" ? "#fca5a5" : v.status === "IN_SERVICE" ? "#bfdbfe" : "#bbf7d0"}`
                                            }}>
                                                {v.status || "ACTIVE"}
                                            </span>
                                        </td>
                                        <td style={{ padding: "14px 18px", textAlign: "right" }}>
                                            <button
                                                onClick={() => openPermanentModal(v.permanent_ward || "", v.id)}
                                                style={{
                                                    backgroundColor: isAssigned ? "#f8fafc" : "#047857",
                                                    color: isAssigned ? "#0f172a" : "white",
                                                    border: isAssigned ? "1px solid #cbd5e1" : "none",
                                                    padding: "6px 14px",
                                                    borderRadius: "6px",
                                                    fontSize: "12px",
                                                    fontWeight: "700",
                                                    cursor: "pointer"
                                                }}
                                            >
                                                {isAssigned ? "Change Assignment" : "Assign Permanent Area"}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#64748b", fontSize: "15px", fontWeight: "600" }}>
                    Loading permanent area mappings and collection points...
                </div>
            ) : (
                /* WARD ASSIGNMENT CARDS */
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {wardData.map((w) => {
                        const permVeh = w.permanent_vehicle;
                        const tempVeh = w.temporary_vehicle;
                        const isUnderMaintenance = w.is_maintenance;
                        const hasReplacement = w.has_replacement;

                        return (
                            <div
                                key={w.ward}
                                style={{
                                    backgroundColor: "white",
                                    borderRadius: "14px",
                                    border: isUnderMaintenance && !hasReplacement
                                        ? "2px solid #ef4444"
                                        : hasReplacement
                                            ? "2px solid #3b82f6"
                                            : "1px solid #e2e8f0",
                                    boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                                    overflow: "hidden"
                                }}
                            >
                                {/* Card Top Bar */}
                                <div style={{
                                    padding: "16px 20px",
                                    backgroundColor: isUnderMaintenance && !hasReplacement
                                        ? "#fff1f2"
                                        : hasReplacement
                                            ? "#eff6ff"
                                            : "#f8fafc",
                                    borderBottom: "1px solid #e2e8f0",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    gap: "12px"
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                        <span style={{ fontSize: "20px" }}>📍</span>
                                        <div>
                                            <h2 style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                                                {w.ward}
                                            </h2>
                                            <span style={{ fontSize: "12px", color: "#64748b" }}>
                                                {w.total_points} Fixed Collection Point{w.total_points !== 1 ? "s" : ""}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Operating Status Badge & Actions */}
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                        {isUnderMaintenance && !hasReplacement && (
                                            <span style={{
                                                backgroundColor: "#fee2e2",
                                                color: "#b91c1c",
                                                padding: "5px 12px",
                                                borderRadius: "20px",
                                                fontSize: "12px",
                                                fontWeight: "800",
                                                border: "1px solid #fecaca"
                                            }}>
                                                ⚠️ VEHICLE UNDER MAINTENANCE (Replacement Required)
                                            </span>
                                        )}

                                        {hasReplacement && (
                                            <span style={{
                                                backgroundColor: "#dbeafe",
                                                color: "#1d4ed8",
                                                padding: "5px 12px",
                                                borderRadius: "20px",
                                                fontSize: "12px",
                                                fontWeight: "800",
                                                border: "1px solid #bfdbfe"
                                            }}>
                                                🔄 TEMPORARY REPLACEMENT ACTIVE ({tempVeh?.vehicle_number})
                                            </span>
                                        )}

                                        {!isUnderMaintenance && permVeh && (
                                            <span style={{
                                                backgroundColor: "#dcfce7",
                                                color: "#15803d",
                                                padding: "5px 12px",
                                                borderRadius: "20px",
                                                fontSize: "12px",
                                                fontWeight: "800",
                                                border: "1px solid #bbf7d0"
                                            }}>
                                                🟢 NORMAL DAILY OPERATION
                                            </span>
                                        )}

                                        {/* Action: Configure Permanent Assignment */}
                                        <button
                                            onClick={() => openPermanentModal(w.ward, permVeh?.vehicle_id)}
                                            style={{
                                                backgroundColor: "#ffffff",
                                                color: "#0f172a",
                                                border: "1px solid #cbd5e1",
                                                padding: "6px 12px",
                                                borderRadius: "6px",
                                                fontSize: "12px",
                                                fontWeight: "700",
                                                cursor: "pointer"
                                            }}
                                        >
                                            {permVeh ? "🔄 Change Assignment" : "➕ Assign Permanent Area"}
                                        </button>

                                        {/* Action: Assign Replacement (When Maintenance occurs) */}
                                        {isUnderMaintenance && !hasReplacement && (
                                            <button
                                                onClick={() => openReplacementModal(w)}
                                                style={{
                                                    backgroundColor: "#dc2626",
                                                    color: "white",
                                                    border: "none",
                                                    padding: "6px 14px",
                                                    borderRadius: "6px",
                                                    fontSize: "12px",
                                                    fontWeight: "800",
                                                    cursor: "pointer",
                                                    boxShadow: "0 2px 4px rgba(220,38,38,0.3)"
                                                }}
                                            >
                                                Assign Replacement Vehicle
                                            </button>
                                        )}

                                        {/* Action: End Replacement */}
                                        {hasReplacement && (
                                            <button
                                                onClick={() => handleRemoveReplacement(w.ward)}
                                                style={{
                                                    backgroundColor: "#ffffff",
                                                    color: "#dc2626",
                                                    border: "1px solid #fca5a5",
                                                    padding: "6px 12px",
                                                    borderRadius: "6px",
                                                    fontSize: "12px",
                                                    fontWeight: "700",
                                                    cursor: "pointer"
                                                }}
                                            >
                                                End Replacement
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Card Body: 2 Columns (Vehicle Assignment & Collection Points) */}
                                <div style={{ padding: "20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
                                    {/* Left: Vehicle & Driver Information */}
                                    <div style={{ backgroundColor: "#f8fafc", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#475569", textTransform: "uppercase", marginBottom: "10px", letterSpacing: "0.5px" }}>
                                            🚛 Permanent Vehicle Mapping
                                        </div>

                                        {permVeh ? (
                                            <div>
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                                    <span style={{ fontSize: "16px", fontWeight: "800", color: "#0f172a" }}>
                                                        {permVeh.vehicle_number}
                                                    </span>
                                                    <span style={{
                                                        padding: "2px 8px",
                                                        borderRadius: "10px",
                                                        fontSize: "11px",
                                                        fontWeight: "800",
                                                        backgroundColor: permVeh.vehicle_status === "MAINTENANCE" ? "#fee2e2" : "#dcfce7",
                                                        color: permVeh.vehicle_status === "MAINTENANCE" ? "#b91c1c" : "#15803d"
                                                    }}>
                                                        {permVeh.vehicle_status}
                                                    </span>
                                                </div>

                                                <div style={{ fontSize: "13px", color: "#334155", marginBottom: "4px" }}>
                                                    Driver: <strong>{permVeh.driver_name || "Unassigned"}</strong>
                                                </div>
                                                <div style={{ fontSize: "13px", color: "#64748b" }}>
                                                    Phone: {permVeh.driver_phone || "Not available"}
                                                </div>

                                                {/* If temporary replacement is active, show temporary vehicle details */}
                                                {hasReplacement && tempVeh && (
                                                    <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px dashed #bfdbfe", backgroundColor: "#f0f9ff", padding: "10px", borderRadius: "8px" }}>
                                                        <div style={{ fontSize: "11px", fontWeight: "800", color: "#1e40af", textTransform: "uppercase" }}>
                                                            🔄 Active Temporary Replacement (Today)
                                                        </div>
                                                        <div style={{ fontSize: "14px", fontWeight: "800", color: "#1d4ed8", marginTop: "4px" }}>
                                                            {tempVeh.vehicle_number} (Driver: {tempVeh.driver_name || "Unassigned"})
                                                        </div>
                                                        <div style={{ fontSize: "11px", color: "#2563eb", marginTop: "2px" }}>
                                                            Covering {w.ward} while {permVeh.vehicle_number} is under maintenance.
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div>
                                                <div style={{ color: "#dc2626", fontSize: "13px", fontWeight: "600", marginBottom: "10px" }}>
                                                    No permanent vehicle assigned to this area yet.
                                                </div>
                                                <button
                                                    onClick={() => openPermanentModal(w.ward)}
                                                    style={{
                                                        backgroundColor: "#047857",
                                                        color: "white",
                                                        padding: "6px 12px",
                                                        borderRadius: "6px",
                                                        border: "none",
                                                        fontWeight: "700",
                                                        fontSize: "12px",
                                                        cursor: "pointer"
                                                    }}
                                                >
                                                    Assign Permanent Area
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Right: Fixed Collection Points belonging to this Ward */}
                                    <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#475569", textTransform: "uppercase", marginBottom: "10px", letterSpacing: "0.5px" }}>
                                            🗑️ Fixed Ward Collection Points ({w.collection_points.length})
                                        </div>

                                        <div style={{ maxHeight: "160px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                                            {w.collection_points.length === 0 ? (
                                                <div style={{ fontSize: "13px", color: "#94a3b8" }}>No collection points registered in this ward.</div>
                                            ) : (
                                                w.collection_points.map((pt, idx) => (
                                                    <div
                                                        key={pt.id}
                                                        style={{
                                                            fontSize: "13px",
                                                            color: "#334155",
                                                            padding: "6px 10px",
                                                            backgroundColor: "#f8fafc",
                                                            borderRadius: "6px",
                                                            border: "1px solid #f1f5f9",
                                                            display: "flex",
                                                            justifyContent: "space-between",
                                                            alignItems: "center"
                                                        }}
                                                    >
                                                        <span><strong>{idx + 1}. {pt.name}</strong> <span style={{ color: "#64748b", fontSize: "12px" }}>({pt.address})</span></span>
                                                        <span style={{ fontSize: "11px", color: "#047857", fontWeight: "700", backgroundColor: "#ecfdf5", padding: "2px 6px", borderRadius: "4px" }}>
                                                            {pt.scheduled_time || "09:00 AM"}
                                                        </span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* MODAL 1: SET / CHANGE PERMANENT VEHICLE FOR AREA */}
            {showPermanentModal && (
                <div style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
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
                        maxWidth: "540px",
                        width: "100%",
                        padding: "26px",
                        boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)",
                        maxHeight: "90vh",
                        overflowY: "auto"
                    }}>
                        {/* Selected vehicle details & availability calculations */}
                        {(() => {
                            const selectedVehObj = vehicles.find(v => v.id.toString() === (selectedVehForPerm || "").toString());
                            const selectedVehCurrentWard = selectedVehObj?.permanent_ward || wardData.find(w => w.permanent_vehicle?.vehicle_id?.toString() === (selectedVehForPerm || "").toString())?.ward || null;
                            const isAlreadyAssigned = Boolean(selectedVehCurrentWard);

                            // Available wards for this vehicle = wards that are unassigned OR already assigned to this vehicle
                            const availableWardsForSelectedVeh = wardData.filter(w => {
                                if (!w.permanent_vehicle) return true;
                                if (selectedVehForPerm && w.permanent_vehicle.vehicle_id?.toString() === selectedVehForPerm.toString()) return true;
                                return false;
                            });

                            const noAvailableAreas = selectedVehForPerm && availableWardsForSelectedVeh.length === 0;

                            return (
                                <form onSubmit={handleSavePermanentAssignment}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                                        <h2 style={{ fontSize: "19px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                                            {isAlreadyAssigned ? "Change Permanent Area Assignment" : "Assign Permanent Area"}
                                        </h2>
                                        <button
                                            type="button"
                                            onClick={() => setShowPermanentModal(false)}
                                            style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: "#64748b" }}
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px 0", lineHeight: "1.4" }}>
                                        {isAlreadyAssigned
                                            ? `Change the permanent operational area for Vehicle ${selectedVehObj?.vehicle_number || ""}. The previous area will automatically become available for other vehicles.`
                                            : "Assigning a permanent vehicle to an area creates a default operational relationship that persists indefinitely across all future dates."
                                        }
                                    </p>

                                    {/* Step 1: Vehicle Selection */}
                                    <div style={{ marginBottom: "16px" }}>
                                        <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                                            Vehicle
                                        </label>
                                        <select
                                            value={selectedVehForPerm}
                                            onChange={(e) => handleModalVehChange(e.target.value)}
                                            required
                                            style={{
                                                width: "100%",
                                                padding: "10px 12px",
                                                borderRadius: "8px",
                                                border: "1px solid #cbd5e1",
                                                fontSize: "14px",
                                                fontWeight: "600",
                                                color: "#0f172a",
                                                backgroundColor: "#ffffff"
                                            }}
                                        >
                                            <option value="">Select Vehicle...</option>
                                            {vehicles.map(v => {
                                                const isMaint = v.status === "MAINTENANCE";
                                                return (
                                                    <option key={v.id} value={v.id}>
                                                        {v.vehicle_number} - {v.driver_name || "Unassigned"} ({v.status}) {isMaint ? `[Maintenance]` : v.permanent_ward ? `[Current: ${v.permanent_ward}]` : "[Unassigned]"}
                                                    </option>
                                                );
                                            })}
                                        </select>

                                        {/* Display Current Permanent Area of Selected Vehicle */}
                                        {selectedVehForPerm && (
                                            <div style={{
                                                marginTop: "8px",
                                                padding: "8px 12px",
                                                backgroundColor: selectedVehCurrentWard ? "#f0fdf4" : "#f8fafc",
                                                borderRadius: "6px",
                                                border: `1px solid ${selectedVehCurrentWard ? "#bbf7d0" : "#e2e8f0"}`,
                                                fontSize: "12px",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between"
                                            }}>
                                                <span style={{ color: "#475569", fontWeight: "600" }}>Current Permanent Area:</span>
                                                {selectedVehCurrentWard ? (
                                                    <span style={{ color: "#15803d", fontWeight: "800" }}>📍 {selectedVehCurrentWard}</span>
                                                ) : (
                                                    <span style={{ color: "#64748b", fontStyle: "italic", fontWeight: "600" }}>Not Assigned</span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Step 2: Target Area / Ward Selection */}
                                    <div style={{ marginBottom: "16px" }}>
                                        <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                                            {isAlreadyAssigned ? "New Target Area / Ward" : "Target Area / Ward"}
                                        </label>

                                        {!selectedVehForPerm ? (
                                            <div style={{
                                                padding: "10px 12px",
                                                backgroundColor: "#f8fafc",
                                                borderRadius: "8px",
                                                border: "1px solid #e2e8f0",
                                                color: "#64748b",
                                                fontSize: "13px"
                                            }}>
                                                Please select a vehicle above to view available service areas.
                                            </div>
                                        ) : noAvailableAreas ? (
                                            <div style={{
                                                padding: "12px 14px",
                                                backgroundColor: "#fef2f2",
                                                borderRadius: "8px",
                                                border: "1px solid #fecaca",
                                                color: "#b91c1c",
                                                fontSize: "13px",
                                                fontWeight: "600"
                                            }}>
                                                ⚠️ All areas have been permanently assigned to other vehicles. No unassigned areas available.
                                            </div>
                                        ) : (
                                            <select
                                                value={selectedWardForPerm}
                                                onChange={(e) => setSelectedWardForPerm(e.target.value)}
                                                required
                                                style={{
                                                    width: "100%",
                                                    padding: "10px 12px",
                                                    borderRadius: "8px",
                                                    border: "1px solid #cbd5e1",
                                                    fontSize: "14px",
                                                    fontWeight: "600",
                                                    color: "#0f172a",
                                                    backgroundColor: "#ffffff"
                                                }}
                                            >
                                                <option value="">Select Target Area / Ward...</option>
                                                {availableWardsForSelectedVeh.map(w => {
                                                    const isCurrent = w.ward === selectedVehCurrentWard;
                                                    return (
                                                        <option key={w.ward} value={w.ward}>
                                                            📍 {w.ward} ({w.total_points} Collection Points) {isCurrent ? "★ (Current Assignment)" : "✓ (Available)"}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        )}
                                    </div>

                                    {/* Step 3: Show Collection Points belonging to the Selected Area */}
                                    {selectedWardForPerm && (
                                        <div style={{
                                            backgroundColor: "#f8fafc",
                                            border: "1px solid #e2e8f0",
                                            borderRadius: "10px",
                                            padding: "12px 14px",
                                            marginBottom: "16px"
                                        }}>
                                            <div style={{ fontSize: "12px", fontWeight: "800", color: "#0f172a", textTransform: "uppercase", marginBottom: "6px" }}>
                                                🗑️ Fixed Collection Points in {selectedWardForPerm} ({selectedWardPoints.length})
                                            </div>
                                            <div style={{ maxHeight: "120px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
                                                {selectedWardPoints.length === 0 ? (
                                                    <div style={{ fontSize: "12px", color: "#94a3b8" }}>No collection points registered in this ward.</div>
                                                ) : (
                                                    selectedWardPoints.map((pt, idx) => (
                                                        <div key={pt.id} style={{ fontSize: "12px", color: "#334155", display: "flex", justifyContent: "space-between" }}>
                                                            <span><strong>{idx + 1}. {pt.name}</strong> <span style={{ color: "#64748b" }}>({pt.address})</span></span>
                                                            <span style={{ color: "#047857", fontWeight: "700" }}>{pt.scheduled_time || "09:00 AM"}</span>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                                        <button
                                            type="button"
                                            onClick={() => setShowPermanentModal(false)}
                                            style={{ backgroundColor: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", padding: "10px 16px", borderRadius: "8px", fontWeight: "700", cursor: "pointer" }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={submitting || !selectedVehForPerm || !selectedWardForPerm || noAvailableAreas}
                                            style={{
                                                backgroundColor: (submitting || !selectedVehForPerm || !selectedWardForPerm || noAvailableAreas) ? "#94a3b8" : "#047857",
                                                color: "white",
                                                border: "none",
                                                padding: "10px 20px",
                                                borderRadius: "8px",
                                                fontWeight: "700",
                                                cursor: (submitting || !selectedVehForPerm || !selectedWardForPerm || noAvailableAreas) ? "not-allowed" : "pointer",
                                                boxShadow: (submitting || !selectedVehForPerm || !selectedWardForPerm || noAvailableAreas) ? "none" : "0 2px 4px rgba(4,120,87,0.25)"
                                            }}
                                        >
                                            {submitting
                                                ? "Saving..."
                                                : isAlreadyAssigned
                                                    ? "Change Assignment"
                                                    : "Assign Permanent Area"
                                            }
                                        </button>
                                    </div>
                                </form>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* MODAL 2: ASSIGN TEMPORARY REPLACEMENT VEHICLE (MAINTENANCE ONLY) */}
            {showReplacementModal && maintWardInfo && (
                <div style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
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
                        maxWidth: "540px",
                        width: "100%",
                        padding: "24px",
                        boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "22px" }}>⚠️</span>
                                <h2 style={{ fontSize: "18px", fontWeight: "800", color: "#991b1b", margin: 0 }}>
                                    Assign Replacement Vehicle
                                </h2>
                            </div>
                            <button
                                onClick={() => setShowReplacementModal(false)}
                                style={{ background: "transparent", border: "none", fontSize: "18px", cursor: "pointer", color: "#64748b" }}
                            >
                                ✕
                            </button>
                        </div>

                        <div style={{ backgroundColor: "#fff1f2", border: "1px solid #fecdd3", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px" }}>
                            <div style={{ fontSize: "13px", color: "#881337" }}>
                                <strong>Affected Area:</strong> {maintWardInfo.ward} ({maintWardInfo.total_points} Collection Points)
                            </div>
                            <div style={{ fontSize: "13px", color: "#881337", marginTop: "4px" }}>
                                <strong>Original Vehicle:</strong> {maintWardInfo.permanent_vehicle?.vehicle_number} (Status: <span style={{ fontWeight: "800", color: "#b91c1c" }}>MAINTENANCE</span>)
                            </div>
                        </div>

                        <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px 0" }}>
                            Select an eligible vehicle to temporarily cover waste collection in <strong>{maintWardInfo.ward}</strong>. The permanent mapping of {maintWardInfo.permanent_vehicle?.vehicle_number} remains intact and will resume automatically once returned to service.
                        </p>

                        <form onSubmit={handleSaveReplacement}>
                            <div style={{ marginBottom: "20px" }}>
                                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                                    Choose Eligible Replacement Vehicle
                                </label>
                                <select
                                    value={selectedReplacementVehId}
                                    onChange={(e) => setSelectedReplacementVehId(e.target.value)}
                                    required
                                    style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "14px", fontWeight: "600" }}
                                >
                                    <option value="">Select an available vehicle...</option>
                                    {eligibleReplacements
                                        .filter(v => v.id !== (maintWardInfo.permanent_vehicle?.vehicle_id || maintWardInfo.permanent_vehicle?.id))
                                        .map(v => (
                                            <option key={v.id} value={v.id}>
                                                {v.vehicle_number} - {v.driver_name || "Unassigned"} ({v.status}) {v.permanent_ward ? `[Permanent: ${v.permanent_ward}]` : ""}
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>

                            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                                <button
                                    type="button"
                                    onClick={() => setShowReplacementModal(false)}
                                    style={{ backgroundColor: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1", padding: "10px 16px", borderRadius: "8px", fontWeight: "700", cursor: "pointer" }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    style={{ backgroundColor: "#dc2626", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", fontWeight: "700", cursor: "pointer" }}
                                >
                                    {submitting ? "Assigning Replacement..." : "Confirm Temporary Replacement"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default AssignVehiclePage;
