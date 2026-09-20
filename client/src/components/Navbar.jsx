import React from "react";

function Navbar({ user, onLogout }) {
    return (
        <header style={{
            height: "64px",
            backgroundColor: "#ffffff",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 28px",
            position: "sticky",
            top: 0,
            zIndex: 100
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "24px" }}>🍃</span>
                <span style={{ fontSize: "20px", fontWeight: "700", color: "#065f46" }}>CleanTrack</span>
                <span style={{ fontSize: "12px", backgroundColor: "#ecfdf5", color: "#047857", padding: "2px 8px", borderRadius: "12px", fontWeight: "600" }}>
                    Smart Waste System
                </span>
            </div>

            {user && (
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            backgroundColor: "#10b981",
                            color: "white",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: "bold",
                            fontSize: "15px"
                        }}>
                            {user.name ? user.name.charAt(0).toUpperCase() : "U"}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: "14px", fontWeight: "600", color: "#1e293b" }}>{user.name}</span>
                            <span style={{ fontSize: "11px", color: "#64748b", textTransform: "uppercase", fontWeight: "600" }}>
                                {user.role}
                            </span>
                        </div>
                    </div>

                    <button
                        onClick={onLogout}
                        style={{
                            padding: "6px 14px",
                            fontSize: "13px",
                            backgroundColor: "#f1f5f9",
                            color: "#475569",
                            border: "1px solid #cbd5e1",
                            borderRadius: "6px",
                            cursor: "pointer",
                            fontWeight: "500",
                            transition: "all 0.2s"
                        }}
                    >
                        Logout
                    </button>
                </div>
            )}
        </header>
    );
}

export default Navbar;
