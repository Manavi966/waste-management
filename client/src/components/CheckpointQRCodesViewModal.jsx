import React from "react";

function CheckpointQRCodesViewModal({ isOpen, onClose, stop }) {
    if (!isOpen || !stop) return null;

    const cp = stop.collection_point || stop;
    const checkpoints = stop.checkpoints || [];

    return (
        <div style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3100,
            padding: "16px"
        }}>
            <div style={{
                backgroundColor: "#1e293b",
                borderRadius: "18px",
                border: "2px solid #334155",
                width: "720px",
                maxWidth: "100%",
                maxHeight: "90vh",
                overflowY: "auto",
                boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
                display: "flex",
                flexDirection: "column"
            }}>
                {/* Header */}
                <div style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid #334155",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    backgroundColor: "#0f172a"
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "24px" }}>🏷️</span>
                        <div>
                            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "#f8fafc" }}>
                                Physical Checkpoint QR Codes
                            </h3>
                            <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                                Collection Zone: <strong>{cp.name}</strong> ({cp.ward})
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: "#94a3b8",
                            fontSize: "22px",
                            cursor: "pointer",
                            padding: "4px 8px"
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Content with QR Code Cards */}
                <div style={{ padding: "20px" }}>
                    <p style={{ fontSize: "13px", color: "#cbd5e1", marginTop: 0, marginBottom: "16px" }}>
                        Below are the printable/scannable QR checkpoints deployed across <strong>{cp.name}</strong>. Point your device camera in the Driver Dashboard to scan each checkpoint.
                    </p>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                        {checkpoints.map((c, i) => {
                            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(c.scanner_code)}`;

                            return (
                                <div
                                    key={c.id || i}
                                    style={{
                                        backgroundColor: "#ffffff",
                                        borderRadius: "12px",
                                        padding: "16px",
                                        textAlign: "center",
                                        border: "2px solid",
                                        borderColor: c.is_scanned ? "#16a34a" : "#cbd5e1",
                                        boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center"
                                    }}
                                >
                                    <div style={{ fontSize: "11px", fontWeight: "800", color: "#047857", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                        {cp.ward} • CHECKPOINT #{c.sequence || (i + 1)}
                                    </div>
                                    <div style={{ fontSize: "14px", fontWeight: "900", color: "#0f172a", marginTop: "2px", marginBottom: "8px" }}>
                                        {c.name || `Scanner ${i + 1}`}
                                    </div>

                                    {/* QR Code Image */}
                                    <div style={{
                                        backgroundColor: "#f8fafc",
                                        padding: "8px",
                                        borderRadius: "8px",
                                        border: "1px solid #e2e8f0",
                                        marginBottom: "8px"
                                    }}>
                                        <img
                                            src={qrUrl}
                                            alt={c.scanner_code}
                                            style={{ width: "160px", height: "160px", display: "block" }}
                                        />
                                    </div>

                                    {/* Scanner Code String */}
                                    <div style={{
                                        fontSize: "12px",
                                        fontFamily: "monospace",
                                        fontWeight: "800",
                                        color: "#1e293b",
                                        backgroundColor: "#f1f5f9",
                                        padding: "4px 8px",
                                        borderRadius: "6px",
                                        border: "1px solid #e2e8f0"
                                    }}>
                                        {c.scanner_code}
                                    </div>

                                    {/* Verification Status Tag */}
                                    <div style={{ marginTop: "8px" }}>
                                        {c.is_scanned ? (
                                            <span style={{ fontSize: "11px", fontWeight: "800", color: "#16a34a", backgroundColor: "#dcfce7", padding: "3px 8px", borderRadius: "10px" }}>
                                                ✅ Verified
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: "11px", fontWeight: "700", color: "#b45309", backgroundColor: "#fef3c7", padding: "3px 8px", borderRadius: "10px" }}>
                                                ⏳ Pending Scan
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: "12px 20px",
                    borderTop: "1px solid #334155",
                    backgroundColor: "#0f172a",
                    display: "flex",
                    justifyContent: "flex-end"
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: "7px 18px",
                            backgroundColor: "#334155",
                            color: "#f8fafc",
                            border: "none",
                            borderRadius: "6px",
                            fontWeight: "700",
                            fontSize: "13px",
                            cursor: "pointer"
                        }}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default CheckpointQRCodesViewModal;
