import React from "react";

function Sidebar({ activeTab, setActiveTab, role, onLogout }) {
    const authorityItems = [
        { id: "dashboard", label: "Dashboard", icon: "📊" },
        { id: "vehicles", label: "Vehicles", icon: "🚛" },
        { id: "assign-vehicle", label: "Assign Collection Points", icon: "📋" },
        { id: "complaints", label: "Complaints", icon: "💬" }
    ];

    const citizenItems = [
        { id: "track-vehicle", label: "Track Vehicle", icon: "🗺️" },
        { id: "raise-complaint", label: "Raise Complaint", icon: "⚠️" },
        { id: "my-complaints", label: "My Complaints", icon: "📋" }
    ];

    const items = role === "CITIZEN" ? citizenItems : authorityItems;

    return (
        <aside style={{
            width: "240px",
            backgroundColor: "#064e3b",
            color: "#ffffff",
            display: "flex",
            flexDirection: "column",
            minHeight: "calc(100vh - 64px)",
            padding: "20px 0",
            flexShrink: 0
        }}>
            <div style={{ padding: "0 20px 16px 20px", borderBottom: "1px solid #047857", marginBottom: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "20px" }}>🍃</span>
                    <span style={{ fontWeight: "700", fontSize: "16px", letterSpacing: "0.5px" }}>CleanTrack</span>
                </div>
            </div>

            <nav style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "0 12px", flex: 1 }}>
                {items.map((item) => {
                    const isActive = activeTab === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => setActiveTab(item.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                padding: "12px 16px",
                                borderRadius: "8px",
                                border: "none",
                                backgroundColor: isActive ? "#047857" : "transparent",
                                color: isActive ? "#ffffff" : "#a7f3d0",
                                cursor: "pointer",
                                fontSize: "14px",
                                fontWeight: isActive ? "600" : "400",
                                textAlign: "left",
                                transition: "all 0.15s ease"
                            }}
                        >
                            <span style={{ fontSize: "16px" }}>{item.icon}</span>
                            <span>{item.label}</span>
                        </button>
                    );
                })}
            </nav>

            <div style={{ padding: "16px 12px 0 12px", borderTop: "1px solid #047857" }}>
                <button
                    onClick={onLogout}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        width: "100%",
                        padding: "10px 16px",
                        borderRadius: "8px",
                        border: "none",
                        backgroundColor: "transparent",
                        color: "#fca5a5",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        textAlign: "left"
                    }}
                >
                    <span>⬅️</span>
                    <span>Logout</span>
                </button>
            </div>
        </aside>
    );
}

export default Sidebar;
