import React, { useState, useEffect } from "react";
import api from "../services/api";

function AssignVehiclePage() {
    const [vehicles, setVehicles] = useState([]);
    const [points, setPoints] = useState([]);
    const [counts, setCounts] = useState({ total: 0, available: 0, assigned_to_current: 0, assigned_to_other: 0, total_assigned: 0 });
    const [selectedDate, setSelectedDate] = useState("2026-09-20");
    const [selectedVehicleId, setSelectedVehicleId] = useState("");
    const [selectedPointIds, setSelectedPointIds] = useState([]);
    const [optimizedRoute, setOptimizedRoute] = useState(null);

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState({ text: "", isError: false, isConflict: false });

    // Maintenance section state
    const [maintenanceVehicles, setMaintenanceVehicles] = useState([]);
    const [reassignTargets, setReassignTargets] = useState({});

    // Load vehicles list on mount or date change
    const loadVehicles = async (dateToUse = selectedDate) => {
        try {
            const vRes = await api.get("/vehicles");
            const allVehicles = vRes.data || [];
            setVehicles(allVehicles);

            // Check maintenance vehicles with pending points
            const maintList = [];
            for (const v of allVehicles) {
                if (v.status === "MAINTENANCE") {
                    try {
                        const detailsRes = await api.get(`/vehicles/${v.id}/details?date=${dateToUse}`);
                        const pendingStops = detailsRes.data.pending_areas || [];
                        maintList.push({
                            ...v,
                            pendingStops,
                            needsReassignment: pendingStops.length > 0
                        });
                    } catch (e) {
                        maintList.push({ ...v, pendingStops: [], needsReassignment: false });
                    }
                }
            }
            setMaintenanceVehicles(maintList);
        } catch (err) {
            console.error("Failed to load vehicles:", err);
            setMessage({ text: "Failed to load vehicles list.", isError: true, isConflict: false });
        } finally {
            setLoading(false);
        }
    };

    // Fetch dynamic collection point availability and existing vehicle route from backend
    const fetchPointsAndRoute = async (vehicleId, dateStr) => {
        if (!vehicleId) {
            setPoints([]);
            setSelectedPointIds([]);
            setOptimizedRoute(null);
            setCounts({ total: 0, available: 0, assigned_to_current: 0, assigned_to_other: 0, total_assigned: 0 });
            return;
        }

        try {
            const [availRes, detailsRes] = await Promise.all([
                api.get(`/admin/available-collection-points?date=${dateStr}&vehicle_id=${vehicleId}`)
                    .catch(() => api.get(`/collection-points/available?date=${dateStr}&vehicle_id=${vehicleId}`)),
                api.get(`/vehicles/${vehicleId}/details?date=${dateStr}`).catch(() => ({ data: null }))
            ]);

            const pointList = availRes.data.points || [];
            setPoints(pointList);
            setCounts(availRes.data.counts || {
                total: pointList.length,
                available: pointList.filter(p => p.assignment_status === "AVAILABLE").length,
                assigned_to_current: pointList.filter(p => p.assignment_status === "ASSIGNED_TO_CURRENT").length,
                assigned_to_other: pointList.filter(p => p.assignment_status === "ASSIGNED_TO_OTHER").length,
                total_assigned: pointList.filter(p => p.assignment_status !== "AVAILABLE").length
            });

            // Pre-select only points already assigned to THIS vehicle
            const currentVehiclePointIds = pointList
                .filter(p => p.assignment_status === "ASSIGNED_TO_CURRENT")
                .map(p => p.id);
            setSelectedPointIds(currentVehiclePointIds);

            // Load optimized route sequence if exists
            const vehicleInfo = detailsRes?.data;
            if (vehicleInfo?.vehicle?.route_id) {
                try {
                    const routeRes = await api.get(`/routes/${vehicleInfo.vehicle.route_id}`);
                    setOptimizedRoute({
                        route: routeRes.data.route,
                        stops: routeRes.data.stops || []
                    });
                } catch (e) {
                    setOptimizedRoute(null);
                }
            } else {
                setOptimizedRoute(null);
            }
        } catch (err) {
            console.error("Error fetching points and route:", err);
            setMessage({ text: "Failed to load collection points for this vehicle.", isError: true, isConflict: false });
        }
    };

    useEffect(() => {
        loadVehicles(selectedDate);
    }, [selectedDate]);

    useEffect(() => {
        if (selectedVehicleId) {
            fetchPointsAndRoute(selectedVehicleId, selectedDate);
        } else {
            setPoints([]);
            setSelectedPointIds([]);
            setOptimizedRoute(null);
        }
    }, [selectedVehicleId, selectedDate]);

    const handleVehicleChange = (newVehId) => {
        setSelectedVehicleId(newVehId);
        setSelectedPointIds([]); // Clear previous vehicle selection
        setMessage({ text: "", isError: false, isConflict: false });
    };

    const handleDateChange = (newDate) => {
        setSelectedDate(newDate);
        setMessage({ text: "", isError: false, isConflict: false });
    };

    const togglePointSelect = (point) => {
        // Points assigned to other vehicles are NOT selectable
        if (point.assignment_status === "ASSIGNED_TO_OTHER") {
            return;
        }

        if (selectedPointIds.includes(point.id)) {
            setSelectedPointIds(selectedPointIds.filter(item => item !== point.id));
        } else {
            setSelectedPointIds([...selectedPointIds, point.id]);
        }
    };

    const handleSelectAllAvailable = () => {
        const availableAndCurrentIds = points
            .filter(p => p.assignment_status === "AVAILABLE" || p.assignment_status === "ASSIGNED_TO_CURRENT")
            .map(p => p.id);
        setSelectedPointIds(availableAndCurrentIds);
    };

    const handleClearSelection = () => {
        setSelectedPointIds([]);
    };

    // Save assignment: Authority manually assigns points to the selected vehicle
    const handleSaveAssignment = async (e) => {
        e.preventDefault();
        if (!selectedVehicleId) {
            setMessage({ text: "Please select a vehicle first.", isError: true, isConflict: false });
            return;
        }

        if (selectedPointIds.length === 0) {
            setMessage({ text: "Please select at least one collection point to assign.", isError: true, isConflict: false });
            return;
        }

        const currentVeh = vehicles.find(v => v.id.toString() === selectedVehicleId.toString());
        if (currentVeh && (currentVeh.status === "MAINTENANCE" || currentVeh.status === "INACTIVE")) {
            setMessage({ text: `Vehicle ${currentVeh.vehicle_number} is under ${currentVeh.status} and cannot receive assignments.`, isError: true, isConflict: false });
            return;
        }

        setSubmitting(true);
        setMessage({ text: "", isError: false, isConflict: false });

        try {
            const response = await api.post("/routes/assign-locations", {
                vehicle_id: Number(selectedVehicleId),
                collection_point_ids: selectedPointIds.map(Number),
                route_date: selectedDate
            });

            setMessage({
                text: response.data.message || `Successfully assigned ${selectedPointIds.length} collection points to ${currentVeh?.vehicle_number}. Route sequence optimized.`,
                isError: false,
                isConflict: false
            });

            // Immediately refresh availability list from backend
            await fetchPointsAndRoute(selectedVehicleId, selectedDate);
        } catch (err) {
            console.error("Assignment error:", err);
            const isConflict = err.response?.status === 409;
            const errorMsg = err.response?.data?.message || "Failed to assign collection points.";

            setMessage({
                text: isConflict ? `⚠️ ${errorMsg}` : errorMsg,
                isError: true,
                isConflict
            });

            // Immediately refresh list from backend so user sees latest state
            await fetchPointsAndRoute(selectedVehicleId, selectedDate);
        } finally {
            setSubmitting(false);
        }
    };

    // Maintenance vehicle reassignment
    const handleReassignMaintenance = async (fromVehicleId) => {
        const toVehicleId = reassignTargets[fromVehicleId];
        if (!toVehicleId) {
            alert("Please select an available replacement vehicle from the dropdown.");
            return;
        }

        setSubmitting(true);
        setMessage({ text: "", isError: false, isConflict: false });

        try {
            const response = await api.post("/routes/reassign-vehicle", {
                from_vehicle_id: Number(fromVehicleId),
                to_vehicle_id: Number(toVehicleId),
                route_date: selectedDate,
                update_from_status: "MAINTENANCE"
            });

            setMessage({
                text: response.data.message || "Collection points successfully reassigned. Route optimized.",
                isError: false,
                isConflict: false
            });

            await loadVehicles(selectedDate);
            if (selectedVehicleId) {
                await fetchPointsAndRoute(selectedVehicleId, selectedDate);
            }
        } catch (err) {
            console.error("Reassignment error:", err);
            setMessage({
                text: err.response?.data?.message || "Failed to reassign collection points.",
                isError: true,
                isConflict: false
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div style={{ padding: "30px" }}>Loading Collection Point Assignment Portal...</div>;

    const selectedVehicle = vehicles.find(v => v.id.toString() === selectedVehicleId.toString());
    const isMaintenance = selectedVehicle && (selectedVehicle.status === "MAINTENANCE" || selectedVehicle.status === "INACTIVE");
    const eligibleReplacementVehicles = vehicles.filter(v => v.status !== "MAINTENANCE" && v.status !== "INACTIVE");

    return (
        <div style={{ padding: "24px", maxWidth: "1250px", margin: "0 auto" }}>
            {/* Header */}
            <div style={{ marginBottom: "24px" }}>
                <h1 style={{ fontSize: "24px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                    Assign Collection Points
                </h1>
                <p style={{ fontSize: "14px", color: "#64748b", margin: "4px 0 0 0" }}>
                    Select an operation date and vehicle, then choose the collection points to assign. The system automatically enforces date uniqueness and optimizes visiting sequence.
                </p>
            </div>

            {/* Notification / Toast Banner */}
            {message.text && (
                <div style={{
                    padding: "14px 18px",
                    borderRadius: "8px",
                    marginBottom: "20px",
                    fontWeight: "600",
                    fontSize: "14px",
                    backgroundColor: message.isConflict ? "#fffbeb" : message.isError ? "#fef2f2" : "#f0fdf4",
                    color: message.isConflict ? "#b45309" : message.isError ? "#dc2626" : "#15803d",
                    border: `1px solid ${message.isConflict ? "#fde68a" : message.isError ? "#fecaca" : "#bbf7d0"}`
                }}>
                    {message.text}
                </div>
            )}

            {/* VEHICLES UNDER MAINTENANCE SECTION */}
            {maintenanceVehicles.length > 0 && (
                <div style={{ backgroundColor: "#fff5f5", padding: "20px", borderRadius: "12px", border: "1px solid #fecaca", marginBottom: "24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                        <span style={{ fontSize: "20px" }}>🛠️</span>
                        <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#991b1b", margin: 0 }}>
                            Vehicles Under Maintenance ({maintenanceVehicles.length})
                        </h2>
                    </div>
                    <p style={{ fontSize: "13px", color: "#7f1d1d", margin: "0 0 14px 0" }}>
                        Vehicles under maintenance cannot receive new assignments. Reassign any pending points to an active vehicle below.
                    </p>

                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {maintenanceVehicles.map(matsVeh => (
                            <div key={matsVeh.id} style={{
                                backgroundColor: "white",
                                padding: "14px 18px",
                                borderRadius: "8px",
                                border: "1px solid #fca5a5",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                flexWrap: "wrap",
                                gap: "12px"
                            }}>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <span style={{ fontWeight: "800", color: "#991b1b", fontSize: "14px" }}>
                                            🚛 {matsVeh.vehicle_number}
                                        </span>
                                        <span style={{ backgroundColor: "#fee2e2", color: "#b91c1c", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "700" }}>
                                            MAINTENANCE (Disabled)
                                        </span>
                                        {matsVeh.needsReassignment && (
                                            <span style={{ backgroundColor: "#fef3c7", color: "#b45309", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: "700" }}>
                                                ⚠️ Requires Reassignment ({matsVeh.pendingStops.length} points)
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>
                                        Driver: <strong>{matsVeh.driver_name || "Unassigned"}</strong>
                                        {matsVeh.needsReassignment && (
                                            <span style={{ marginLeft: "8px", color: "#b91c1c" }}>
                                                • Assigned: {matsVeh.pendingStops.map(s => s.point_name).join(", ")}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {matsVeh.needsReassignment ? (
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <select
                                            value={reassignTargets[matsVeh.id] || ""}
                                            onChange={(e) => setReassignTargets({ ...reassignTargets, [matsVeh.id]: e.target.value })}
                                            style={{ padding: "7px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                                        >
                                            <option value="">Select Replacement Vehicle</option>
                                            {eligibleReplacementVehicles.map(v => (
                                                <option key={v.id} value={v.id}>
                                                    {v.vehicle_number} ({v.status})
                                                </option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={() => handleReassignMaintenance(matsVeh.id)}
                                            disabled={submitting}
                                            style={{
                                                backgroundColor: "#047857",
                                                color: "white",
                                                padding: "7px 14px",
                                                borderRadius: "6px",
                                                border: "none",
                                                fontWeight: "600",
                                                fontSize: "12px",
                                                cursor: "pointer"
                                            }}
                                        >
                                            Reassign Points
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: "12px", color: "#15803d", fontWeight: "600" }}>
                                        ✓ No pending assignments
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* STEP 1 & 2: OPERATION DATE & VEHICLE SELECTION CONTROLS */}
            <div style={{
                backgroundColor: "white",
                padding: "20px 24px",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                marginBottom: "20px",
                display: "flex",
                gap: "24px",
                alignItems: "center",
                flexWrap: "wrap"
            }}>
                {/* Operation Date Picker */}
                <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#475569", textTransform: "uppercase", marginBottom: "6px" }}>
                        Operation Date
                    </label>
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => handleDateChange(e.target.value)}
                        style={{
                            padding: "9px 14px",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "14px",
                            fontWeight: "600",
                            color: "#0f172a"
                        }}
                    />
                </div>

                {/* Vehicle Selection Dropdown (Starts unselected) */}
                <div style={{ flex: 1, minWidth: "300px" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "#475569", textTransform: "uppercase", marginBottom: "6px" }}>
                        Select Vehicle
                    </label>
                    <select
                        value={selectedVehicleId}
                        onChange={(e) => handleVehicleChange(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "9px 14px",
                            borderRadius: "6px",
                            border: selectedVehicleId ? "2px solid #047857" : "1px solid #cbd5e1",
                            fontSize: "14px",
                            fontWeight: "600",
                            color: selectedVehicleId ? "#0f172a" : "#64748b",
                            backgroundColor: selectedVehicleId ? "#f0fdf4" : "#ffffff"
                        }}
                    >
                        <option value="">-- Select a Vehicle --</option>
                        {vehicles.map(v => {
                            const isMaint = v.status === "MAINTENANCE" || v.status === "INACTIVE";
                            return (
                                <option
                                    key={v.id}
                                    value={v.id}
                                    disabled={isMaint}
                                >
                                    {v.vehicle_number} — [{v.status}] — Driver: {v.driver_name || "Unassigned"} {isMaint ? "(Disabled)" : ""}
                                </option>
                            );
                        })}
                    </select>
                </div>
            </div>

            {/* MAINTENANCE VEHICLE WARNING */}
            {isMaintenance && (
                <div style={{
                    backgroundColor: "#fef2f2",
                    color: "#991b1b",
                    padding: "16px 20px",
                    borderRadius: "10px",
                    border: "1px solid #fecaca",
                    fontWeight: "700",
                    fontSize: "14px",
                    marginBottom: "20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px"
                }}>
                    <span style={{ fontSize: "20px" }}>⚠️</span>
                    <span>Vehicle {selectedVehicle.vehicle_number} is under maintenance and cannot receive new collection point assignments.</span>
                </div>
            )}

            {/* DYNAMIC AVAILABILITY STATS COUNTERS */}
            {selectedVehicleId && !isMaintenance && (
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "16px",
                    marginBottom: "24px"
                }}>
                    <div style={{ backgroundColor: "#f0fdf4", padding: "14px 18px", borderRadius: "10px", border: "1px solid #bbf7d0" }}>
                        <div style={{ fontSize: "12px", color: "#166534", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>🟢</span> Available for assignment:
                        </div>
                        <div style={{ fontSize: "26px", fontWeight: "800", color: "#047857", marginTop: "4px" }}>
                            {counts.available}
                        </div>
                    </div>

                    <div style={{ backgroundColor: "#eff6ff", padding: "14px 18px", borderRadius: "10px", border: "1px solid #bfdbfe" }}>
                        <div style={{ fontSize: "12px", color: "#1e40af", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>🔵</span> Assigned to this vehicle:
                        </div>
                        <div style={{ fontSize: "26px", fontWeight: "800", color: "#2563eb", marginTop: "4px" }}>
                            {counts.assigned_to_current}
                        </div>
                    </div>

                    <div style={{ backgroundColor: "#f8fafc", padding: "14px 18px", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                        <div style={{ fontSize: "12px", color: "#475569", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>⚫</span> Assigned to other vehicles:
                        </div>
                        <div style={{ fontSize: "26px", fontWeight: "800", color: "#475569", marginTop: "4px" }}>
                            {counts.assigned_to_other}
                        </div>
                    </div>

                    <div style={{ backgroundColor: "#faf5ff", padding: "14px 18px", borderRadius: "10px", border: "1px solid #e9d5ff" }}>
                        <div style={{ fontSize: "12px", color: "#6b21a8", fontWeight: "700", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>📊</span> Total Collection Points:
                        </div>
                        <div style={{ fontSize: "26px", fontWeight: "800", color: "#7e22ce", marginTop: "4px" }}>
                            {counts.total}
                        </div>
                    </div>
                </div>
            )}

            {/* MAIN WORKFLOW AREA */}
            {!selectedVehicleId ? (
                /* Empty state when no vehicle is selected */
                <div style={{
                    backgroundColor: "white",
                    padding: "48px 24px",
                    borderRadius: "12px",
                    border: "2px dashed #cbd5e1",
                    textAlign: "center",
                    color: "#64748b"
                }}>
                    <div style={{ fontSize: "40px", marginBottom: "12px" }}>🚛</div>
                    <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#1e293b", margin: "0 0 8px 0" }}>
                        Please Select a Vehicle First
                    </h3>
                    <p style={{ fontSize: "14px", color: "#64748b", margin: 0, maxWidth: "500px", marginInline: "auto" }}>
                        Select an active vehicle from the dropdown above to view currently available collection points for <strong>{selectedDate}</strong> and assign points manually.
                    </p>
                </div>
            ) : isMaintenance ? (
                /* Maintenance disabled state */
                <div style={{
                    backgroundColor: "white",
                    padding: "36px 24px",
                    borderRadius: "12px",
                    border: "1px solid #fca5a5",
                    textAlign: "center",
                    color: "#991b1b"
                }}>
                    <div style={{ fontSize: "36px", marginBottom: "10px" }}>🛠️</div>
                    <h3 style={{ fontSize: "16px", fontWeight: "700", margin: "0 0 6px 0" }}>
                        Vehicle Under Maintenance
                    </h3>
                    <p style={{ fontSize: "13px", color: "#7f1d1d", margin: 0 }}>
                        Please choose an active vehicle from the dropdown to assign collection points.
                    </p>
                </div>
            ) : (
                /* Two-column layout for selected vehicle */
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "24px", alignItems: "start" }}>

                    {/* LEFT PANEL: COLLECTION POINTS SELECTION */}
                    <div style={{ backgroundColor: "white", padding: "24px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                            <div>
                                <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "700", color: "#0f172a" }}>
                                    Available Collection Points ({counts.available})
                                </h3>
                                <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                                    Select points for <strong>{selectedVehicle.vehicle_number}</strong> on <strong>{selectedDate}</strong>.
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                    type="button"
                                    onClick={handleSelectAllAvailable}
                                    style={{ padding: "5px 12px", fontSize: "11px", fontWeight: "700", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer", color: "#047857" }}
                                >
                                    Select All Available
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearSelection}
                                    style={{ padding: "5px 12px", fontSize: "11px", fontWeight: "700", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#f8fafc", cursor: "pointer", color: "#64748b" }}
                                >
                                    Clear
                                </button>
                            </div>
                        </div>

                        <form onSubmit={handleSaveAssignment}>
                            <div style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                maxHeight: "480px",
                                overflowY: "auto",
                                padding: "4px",
                                marginBottom: "20px"
                            }}>
                                {points.length === 0 ? (
                                    <div style={{ padding: "30px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
                                        No collection points found.
                                    </div>
                                ) : (
                                    points.map((p) => {
                                        const isSelected = selectedPointIds.includes(p.id);
                                        const isAssignedToOther = p.assignment_status === "ASSIGNED_TO_OTHER";
                                        const isAssignedToCurrent = p.assignment_status === "ASSIGNED_TO_CURRENT";
                                        const isAvailable = p.assignment_status === "AVAILABLE";

                                        return (
                                            <div
                                                key={p.id}
                                                onClick={() => togglePointSelect(p)}
                                                style={{
                                                    padding: "12px 16px",
                                                    borderRadius: "8px",
                                                    border: "1px solid",
                                                    borderColor: isSelected
                                                        ? "#047857"
                                                        : isAssignedToOther
                                                        ? "#e2e8f0"
                                                        : isAvailable
                                                        ? "#cbd5e1"
                                                        : "#e2e8f0",
                                                    backgroundColor: isSelected
                                                        ? "#ecfdf5"
                                                        : isAssignedToOther
                                                        ? "#f8fafc"
                                                        : "#ffffff",
                                                    cursor: isAssignedToOther ? "not-allowed" : "pointer",
                                                    opacity: isAssignedToOther ? 0.75 : 1,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    transition: "all 0.15s ease"
                                                }}
                                            >
                                                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        disabled={isAssignedToOther}
                                                        onChange={() => { }} // Handled by click container
                                                        style={{
                                                            width: "18px",
                                                            height: "18px",
                                                            cursor: isAssignedToOther ? "not-allowed" : "pointer",
                                                            accentColor: "#047857"
                                                        }}
                                                    />
                                                    <div>
                                                        <div style={{
                                                            fontWeight: "700",
                                                            fontSize: "14px",
                                                            color: isAssignedToOther
                                                                ? "#64748b"
                                                                : isSelected
                                                                ? "#047857"
                                                                : "#1e293b"
                                                        }}>
                                                            {p.name}
                                                        </div>
                                                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                                                            📍 {p.ward} • {p.address}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div>
                                                    {isAssignedToOther && (
                                                        <span style={{
                                                            fontSize: "11px",
                                                            fontWeight: "700",
                                                            padding: "4px 10px",
                                                            borderRadius: "12px",
                                                            backgroundColor: "#f1f5f9",
                                                            color: "#475569",
                                                            border: "1px solid #cbd5e1"
                                                        }}>
                                                            🔒 Assigned to {p.vehicle_number}
                                                        </span>
                                                    )}
                                                    {isAssignedToCurrent && (
                                                        <span style={{
                                                            fontSize: "11px",
                                                            fontWeight: "700",
                                                            padding: "4px 10px",
                                                            borderRadius: "12px",
                                                            backgroundColor: "#dbeafe",
                                                            color: "#1e40af",
                                                            border: "1px solid #93c5fd"
                                                        }}>
                                                            🔵 Assigned to this vehicle
                                                        </span>
                                                    )}
                                                    {isAvailable && isSelected && (
                                                        <span style={{
                                                            fontSize: "11px",
                                                            fontWeight: "700",
                                                            padding: "4px 10px",
                                                            borderRadius: "12px",
                                                            backgroundColor: "#dcfce7",
                                                            color: "#15803d",
                                                            border: "1px solid #86efac"
                                                        }}>
                                                            ✓ Selected
                                                        </span>
                                                    )}
                                                    {isAvailable && !isSelected && (
                                                        <span style={{
                                                            fontSize: "11px",
                                                            fontWeight: "700",
                                                            padding: "4px 10px",
                                                            borderRadius: "12px",
                                                            backgroundColor: "#f0fdf4",
                                                            color: "#166534",
                                                            border: "1px solid #bbf7d0"
                                                        }}>
                                                            🟢 Available
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1f5f9", paddingTop: "16px" }}>
                                <div style={{ fontSize: "13px", color: "#64748b" }}>
                                    <strong>{selectedPointIds.length}</strong> collection points selected
                                </div>
                                <button
                                    type="submit"
                                    disabled={submitting || selectedPointIds.length === 0 || !selectedVehicleId}
                                    style={{
                                        backgroundColor: (submitting || selectedPointIds.length === 0 || !selectedVehicleId) ? "#94a3b8" : "#047857",
                                        color: "white",
                                        padding: "11px 24px",
                                        borderRadius: "8px",
                                        border: "none",
                                        fontWeight: "700",
                                        fontSize: "14px",
                                        cursor: (submitting || selectedPointIds.length === 0 || !selectedVehicleId) ? "not-allowed" : "pointer"
                                    }}
                                >
                                    {submitting
                                        ? "Optimizing Route..."
                                        : `ASSIGN TO ${selectedVehicle ? selectedVehicle.vehicle_number : "VEHICLE"}`}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* RIGHT PANEL: CURRENT VEHICLE ASSIGNMENTS & SYSTEM OPTIMIZED SEQUENCE */}
                    <div style={{ backgroundColor: "white", padding: "24px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                        <div style={{ marginBottom: "16px" }}>
                            <h3 style={{ margin: 0, fontSize: "17px", fontWeight: "700", color: "#0f172a" }}>
                                Current Vehicle Assignments
                            </h3>
                            <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#64748b" }}>
                                Vehicle: <strong>{selectedVehicle.vehicle_number}</strong> ({selectedVehicle.status})
                            </p>
                        </div>

                        <div style={{ backgroundColor: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0", marginBottom: "16px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                                <span style={{ fontWeight: "700", color: "#047857", fontSize: "15px" }}>
                                    🚛 {selectedVehicle.vehicle_number}
                                </span>
                                <span style={{ fontSize: "12px", color: "#64748b" }}>
                                    Assigned Stops: <strong>{optimizedRoute ? optimizedRoute.stops.length : 0}</strong>
                                </span>
                            </div>
                            {optimizedRoute && optimizedRoute.route && (
                                <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#475569", marginTop: "6px" }}>
                                    <div>Total Distance: <strong>{optimizedRoute.route.total_distance || 0} km</strong></div>
                                    <div>Estimated Time: <strong>{optimizedRoute.route.estimated_time || 0} mins</strong></div>
                                </div>
                            )}
                        </div>

                        {(!optimizedRoute || optimizedRoute.stops.length === 0) ? (
                            <div style={{
                                padding: "36px 20px",
                                textAlign: "center",
                                backgroundColor: "#f8fafc",
                                borderRadius: "8px",
                                border: "1px dashed #cbd5e1",
                                color: "#64748b",
                                fontSize: "13px"
                            }}>
                                No collection points currently assigned to <strong>{selectedVehicle.vehicle_number}</strong> for {selectedDate}.<br />
                                Select available points on the left and click <strong>"ASSIGN TO {selectedVehicle.vehicle_number}"</strong>.
                            </div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "430px", overflowY: "auto", padding: "2px" }}>
                                {/* Starting depot / GPS location */}
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    padding: "10px 14px",
                                    borderRadius: "8px",
                                    backgroundColor: "#f0fdf4",
                                    border: "1px solid #bbf7d0"
                                }}>
                                    <div style={{
                                        width: "28px",
                                        height: "28px",
                                        borderRadius: "50%",
                                        backgroundColor: "#16a34a",
                                        color: "white",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "14px"
                                    }}>
                                        🚛
                                    </div>
                                    <div>
                                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#166534" }}>
                                            Starting Location
                                        </div>
                                        <div style={{ fontSize: "11px", color: "#64748b" }}>
                                            Vehicle Depot / Live GPS start coordinate
                                        </div>
                                    </div>
                                </div>

                                {/* Sequenced stops */}
                                {optimizedRoute.stops.map((stop, idx) => (
                                    <div
                                        key={stop.id || stop.route_stop_id || idx}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "12px",
                                            padding: "10px 14px",
                                            borderRadius: "8px",
                                            backgroundColor: "#ffffff",
                                            border: "1px solid #e2e8f0"
                                        }}
                                    >
                                        <div style={{
                                            width: "28px",
                                            height: "28px",
                                            borderRadius: "50%",
                                            backgroundColor: "#047857",
                                            color: "white",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontWeight: "700",
                                            fontSize: "13px",
                                            flexShrink: 0
                                        }}>
                                            {stop.sequence || idx + 1}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: "14px", fontWeight: "700", color: "#1e293b" }}>
                                                {stop.name || stop.point_name}
                                            </div>
                                            <div style={{ fontSize: "12px", color: "#64748b" }}>
                                                📍 {stop.address || stop.ward}
                                            </div>
                                        </div>
                                        <span style={{
                                            fontSize: "11px",
                                            fontWeight: "600",
                                            padding: "2px 8px",
                                            borderRadius: "10px",
                                            backgroundColor: stop.status === "COMPLETED" ? "#dcfce7" : stop.status === "MISSED" ? "#fee2e2" : "#f1f5f9",
                                            color: stop.status === "COMPLETED" ? "#15803d" : stop.status === "MISSED" ? "#b91c1c" : "#475569"
                                        }}>
                                            {stop.status || "PENDING"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                </div>
            )}
        </div>
    );
}

export default AssignVehiclePage;
