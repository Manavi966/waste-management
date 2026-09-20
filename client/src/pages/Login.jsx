import React, { useState } from "react";
import api from "../services/api";

function Login({ onLogin, initialRole, onBackToLanding }) {
    const [email, setEmail] = useState(
        initialRole === "DRIVER" ? "ramesh@cleantrack.com" :
        initialRole === "CITIZEN" ? "priya@gmail.com" :
        "authority@cleantrack.com"
    );
    const [password, setPassword] = useState("password123");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage("");

        try {
            const response = await api.post("/auth/login", { email, password });
            localStorage.setItem("token", response.data.token);
            localStorage.setItem("user", JSON.stringify(response.data.user));
            onLogin(response.data.user);
        } catch (error) {
            console.error(error);
            setMessage(error.response?.data?.message || "Login failed. Check email & password.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: "100vh",
            backgroundColor: "#f8fafc",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'Inter', sans-serif"
        }}>
            <div style={{
                backgroundColor: "#ffffff",
                borderRadius: "12px",
                boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
                padding: "40px",
                width: "360px",
                border: "1px solid #e2e8f0"
            }}>
                <div style={{ textAlign: "center", marginBottom: "24px" }}>
                    <span style={{ fontSize: "36px" }}>🍃</span>
                    <h2 style={{ margin: "8px 0 0 0", color: "#065f46", fontSize: "22px", fontWeight: "700" }}>CleanTrack</h2>
                    <p style={{ margin: "4px 0 0 0", color: "#64748b", fontSize: "14px" }}>Sign in to access your portal</p>
                </div>

                <form onSubmit={handleLogin}>
                    <div style={{ marginBottom: "16px" }}>
                        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                            Email Address
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter email"
                            required
                            style={{
                                width: "100%",
                                padding: "10px 14px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                fontSize: "14px",
                                outline: "none"
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: "20px" }}>
                        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#334155", marginBottom: "6px" }}>
                            Password
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password"
                            required
                            style={{
                                width: "100%",
                                padding: "10px 14px",
                                borderRadius: "6px",
                                border: "1px solid #cbd5e1",
                                fontSize: "14px",
                                outline: "none"
                            }}
                        />
                    </div>

                    {message && (
                        <div style={{ marginBottom: "16px", color: "#dc2626", fontSize: "13px", fontWeight: "500" }}>
                            {message}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            width: "100%",
                            backgroundColor: "#047857",
                            color: "white",
                            padding: "12px",
                            borderRadius: "6px",
                            border: "none",
                            fontSize: "15px",
                            fontWeight: "600",
                            cursor: "pointer"
                        }}
                    >
                        {loading ? "Signing in..." : "Login"}
                    </button>
                </form>

                {onBackToLanding && (
                    <div style={{ marginTop: "20px", textAlign: "center" }}>
                        <button
                            onClick={onBackToLanding}
                            style={{ border: "none", background: "none", color: "#047857", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}
                        >
                            ← Back to Home
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Login;