import React from "react";

function LandingPage({ onSelectRole }) {
    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#f8fafc", fontFamily: "'Inter', sans-serif" }}>
            {/* Top Navigation */}
            <header style={{
                backgroundColor: "#ffffff",
                borderBottom: "1px solid #e2e8f0",
                padding: "16px 40px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "28px" }}>🍃</span>
                    <span style={{ fontSize: "22px", fontWeight: "700", color: "#065f46" }}>CleanTrack</span>
                </div>
                <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
                    <a href="#about" style={{ textDecoration: "none", color: "#475569", fontWeight: "500" }}>About</a>
                    <a href="#contact" style={{ textDecoration: "none", color: "#475569", fontWeight: "500" }}>Contact</a>
                    <button
                        onClick={() => onSelectRole("AUTHORITY")}
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
                        Login
                    </button>
                </div>
            </header>

            {/* Hero Section */}
            <section style={{
                backgroundImage: "linear-gradient(rgba(4, 120, 87, 0.85), rgba(6, 78, 59, 0.9)), url('https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&w=1600&q=80')",
                backgroundSize: "cover",
                backgroundPosition: "center",
                color: "white",
                padding: "80px 20px",
                textAlign: "center"
            }}>
                <h1 style={{ fontSize: "44px", fontWeight: "800", marginBottom: "16px" }}>Cleaner Cities<br />Greener Tomorrow</h1>
                <p style={{ fontSize: "18px", maxWidth: "600px", margin: "0 auto 40px auto", opacity: 0.9 }}>
                    Smart waste management for a sustainable and healthier future.
                </p>

                {/* Role Cards Container */}
                <div style={{
                    display: "flex",
                    justifyContent: "center",
                    gap: "24px",
                    flexWrap: "wrap",
                    maxWidth: "1000px",
                    margin: "0 auto"
                }}>
                    {/* Authority Card */}
                    <div style={{
                        backgroundColor: "#ffffff",
                        color: "#1e293b",
                        borderRadius: "12px",
                        padding: "32px 24px",
                        width: "280px",
                        boxShadow: "0 10px 25px -5px rgba(0,0,0,0.2)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center"
                    }}>
                        <div style={{ fontSize: "40px", marginBottom: "16px" }}>🛡️</div>
                        <h3 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "8px", color: "#065f46" }}>Authority</h3>
                        <p style={{ fontSize: "13px", color: "#64748b", textAlign: "center", marginBottom: "24px" }}>
                            Manage vehicles, collection points, view reports and analytics.
                        </p>
                        <button
                            onClick={() => onSelectRole("AUTHORITY")}
                            style={{
                                width: "100%",
                                backgroundColor: "#047857",
                                color: "white",
                                padding: "10px",
                                borderRadius: "6px",
                                border: "none",
                                fontWeight: "600",
                                cursor: "pointer"
                            }}
                        >
                            Login
                        </button>
                    </div>

                    {/* Driver Card */}
                    <div style={{
                        backgroundColor: "#ffffff",
                        color: "#1e293b",
                        borderRadius: "12px",
                        padding: "32px 24px",
                        width: "280px",
                        boxShadow: "0 10px 25px -5px rgba(0,0,0,0.2)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center"
                    }}>
                        <div style={{ fontSize: "40px", marginBottom: "16px" }}>🚛</div>
                        <h3 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "8px", color: "#065f46" }}>Driver</h3>
                        <p style={{ fontSize: "13px", color: "#64748b", textAlign: "center", marginBottom: "24px" }}>
                            Update location, view assigned routes and collection points.
                        </p>
                        <button
                            onClick={() => onSelectRole("DRIVER")}
                            style={{
                                width: "100%",
                                backgroundColor: "#047857",
                                color: "white",
                                padding: "10px",
                                borderRadius: "6px",
                                border: "none",
                                fontWeight: "600",
                                cursor: "pointer"
                            }}
                        >
                            Login
                        </button>
                    </div>

                    {/* Citizen Card */}
                    <div style={{
                        backgroundColor: "#ffffff",
                        color: "#1e293b",
                        borderRadius: "12px",
                        padding: "32px 24px",
                        width: "280px",
                        boxShadow: "0 10px 25px -5px rgba(0,0,0,0.2)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center"
                    }}>
                        <div style={{ fontSize: "40px", marginBottom: "16px" }}>👥</div>
                        <h3 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "8px", color: "#065f46" }}>Citizen</h3>
                        <p style={{ fontSize: "13px", color: "#64748b", textAlign: "center", marginBottom: "24px" }}>
                            Track collection vehicles live, raise complaints, view status.
                        </p>
                        <button
                            onClick={() => onSelectRole("CITIZEN")}
                            style={{
                                width: "100%",
                                backgroundColor: "#047857",
                                color: "white",
                                padding: "10px",
                                borderRadius: "6px",
                                border: "none",
                                fontWeight: "600",
                                cursor: "pointer"
                            }}
                        >
                            Login
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default LandingPage;
