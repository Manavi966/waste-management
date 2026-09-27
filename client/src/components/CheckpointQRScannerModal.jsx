import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

// Synthesize a crisp success chime using the Web Audio API
function playSuccessBeep() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.15);

        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
        // AudioContext not supported or not allowed
    }
}

function CheckpointQRScannerModal({
    isOpen,
    onClose,
    nextStop,
    onScanSuccess,
    vehiclePosition,
    driverId,
    vehicleId,
    api
}) {
    const [scannerActive, setScannerActive] = useState(false);
    const [cameraError, setCameraError] = useState("");
    const [cameras, setCameras] = useState([]);
    const [selectedCameraId, setSelectedCameraId] = useState("");
    const [torchOn, setTorchOn] = useState(false);
    const [torchSupported, setTorchSupported] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [scanResult, setScanResult] = useState(null); // { success: boolean, title: string, message: string, scannerName?: string, progress?: string }
    const [showManualInput, setShowManualInput] = useState(false);
    const [manualCode, setManualCode] = useState("");

    const html5QrCodeRef = useRef(null);
    const isScanningRef = useRef(false);

    const cp = nextStop?.collection_point || nextStop;
    const nextPendingCheckpoint = (nextStop?.checkpoints || []).find(c => !c.is_scanned);
    const totalScanners = nextStop?.total_scanners || (nextStop?.checkpoints?.length) || 3;
    const scannedCount = nextStop?.scanned_count || (nextStop?.checkpoints?.filter(c => c.is_scanned).length) || 0;

    // Start/Stop scanner on open/close
    useEffect(() => {
        if (!isOpen) {
            stopScanner();
            setScanResult(null);
            setCameraError("");
            setVerifying(false);
            setShowManualInput(false);
            setManualCode("");
            return;
        }

        startScanner();

        return () => {
            stopScanner();
        };
    }, [isOpen]);

    const startScanner = async (cameraIdToUse = null) => {
        setCameraError("");
        setScanResult(null);
        setVerifying(false);

        try {
            // Get available video devices
            const devices = await Html5Qrcode.getCameras();
            if (!devices || devices.length === 0) {
                setCameraError("No video camera found on this device.");
                return;
            }

            setCameras(devices);
            
            // Prefer rear/environment camera on mobile phones
            let targetCameraId = cameraIdToUse;
            if (!targetCameraId) {
                const backCamera = devices.find(d => /back|rear|environment/i.test(d.label));
                targetCameraId = backCamera ? backCamera.id : (devices.length > 1 ? devices[devices.length - 1].id : devices[0].id);
            }
            setSelectedCameraId(targetCameraId);

            // Cleanup previous instance
            if (html5QrCodeRef.current) {
                try {
                    if (html5QrCodeRef.current.isScanning) {
                        await html5QrCodeRef.current.stop();
                    }
                    html5QrCodeRef.current.clear();
                } catch (e) {
                    // Ignore
                }
            }

            const qrScannerId = "fullscreen-qr-reader";
            const qrScanner = new Html5Qrcode(qrScannerId);
            html5QrCodeRef.current = qrScanner;

            const config = {
                fps: 12,
                qrbox: (viewfinderWidth, viewfinderHeight) => {
                    const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                    const edgeSize = Math.floor(minEdge * 0.72);
                    return { width: Math.max(220, Math.min(300, edgeSize)), height: Math.max(220, Math.min(300, edgeSize)) };
                },
                aspectRatio: 1.0,
                experimentalFeatures: {
                    useBarCodeDetectorIfSupported: true
                }
            };

            await qrScanner.start(
                targetCameraId,
                config,
                (decodedText) => {
                    handleCodeDetected(decodedText);
                },
                () => {
                    // QR parse frame frame-by-frame error (normal when no QR in view)
                }
            );

            isScanningRef.current = true;
            setScannerActive(true);

            // Check if torch is supported
            try {
                const capabilities = qrScanner.getRunningTrackCapabilities();
                if (capabilities && capabilities.torch) {
                    setTorchSupported(true);
                }
            } catch (te) {
                setTorchSupported(false);
            }

        } catch (err) {
            console.error("Camera start error:", err);
            const errMsg = err?.name === "NotAllowedError" || err?.message?.includes("Permission")
                ? "Camera permission is required to scan the checkpoint. Please allow camera access in your browser settings."
                : `Unable to access camera: ${err?.message || "Please check device permissions."}`;
            setCameraError(errMsg);
            setScannerActive(false);
        }
    };

    const stopScanner = async () => {
        isScanningRef.current = false;
        if (html5QrCodeRef.current) {
            try {
                if (html5QrCodeRef.current.isScanning) {
                    await html5QrCodeRef.current.stop();
                }
                html5QrCodeRef.current.clear();
            } catch (err) {
                console.warn("Error stopping scanner:", err);
            }
            html5QrCodeRef.current = null;
        }
        setScannerActive(false);
        setTorchOn(false);
    };

    const toggleTorch = async () => {
        if (!html5QrCodeRef.current || !torchSupported) return;
        try {
            const nextState = !torchOn;
            await html5QrCodeRef.current.applyVideoConstraints({
                advanced: [{ torch: nextState }]
            });
            setTorchOn(nextState);
        } catch (e) {
            console.warn("Could not toggle torch:", e);
        }
    };

    const flipCamera = async () => {
        if (cameras.length <= 1) return;
        const currentIndex = cameras.findIndex(c => c.id === selectedCameraId);
        const nextIndex = (currentIndex + 1) % cameras.length;
        const nextCamera = cameras[nextIndex];
        setSelectedCameraId(nextCamera.id);
        await startScanner(nextCamera.id);
    };

    // Automatic detection handler
    const handleCodeDetected = async (rawCode) => {
        if (!isScanningRef.current && !rawCode) return;
        if (verifying) return; // Prevent duplicate requests while backend is validating

        isScanningRef.current = false;
        setVerifying(true);
        setScanResult(null);

        try {
            // Clean/parse raw QR text
            let code = rawCode.trim();
            try {
                const parsed = JSON.parse(code);
                if (parsed.code || parsed.scanner_code || parsed.qr_code || parsed.id) {
                    code = parsed.code || parsed.scanner_code || parsed.qr_code || parsed.id;
                }
            } catch (e) {
                if (code.startsWith("http://") || code.startsWith("https://")) {
                    try {
                        const url = new URL(code);
                        const paramCode = url.searchParams.get("code") || url.searchParams.get("scanner");
                        if (paramCode) code = paramCode;
                    } catch (ue) {}
                }
            }

            const payload = {
                scanner_code: code,
                driver_id: driverId,
                vehicle_id: vehicleId
            };

            if (vehiclePosition) {
                payload.latitude = vehiclePosition.latitude;
                payload.longitude = vehiclePosition.longitude;
            }

            const response = await api.post(`/routes/stops/${nextStop.id}/scan`, payload);
            const data = response.data;

            // Trigger success feedback
            playSuccessBeep();
            if (navigator.vibrate) {
                try { navigator.vibrate([120, 60, 120]); } catch (e) {}
            }

            const newScannedCount = data.scanned_count || (scannedCount + 1);
            const formattedProgress = `${newScannedCount} / ${data.total_scanners || totalScanners}`;

            setScanResult({
                success: true,
                title: "CHECKPOINT VERIFIED",
                zoneName: cp?.name || "Collection Zone",
                scannerName: data.scanner?.name || `Scanner ${newScannedCount}`,
                scannerCode: data.scanner?.scanner_code || code,
                progress: formattedProgress,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                allScanned: data.all_scanned,
                isCompleted: data.is_completed || data.ready_for_completion
            });

            if (onScanSuccess) {
                await onScanSuccess(data);
            }

            // Automatically return to Driver Dashboard after showing success state
            setTimeout(() => {
                onClose();
            }, 1400);

        } catch (err) {
            console.error("Scan verification failed:", err);
            const serverMsg = err.response?.data?.message || "Invalid Checkpoint Scan";

            let displayError = "✕ Invalid Checkpoint";
            if (/outside/i.test(serverMsg)) {
                displayError = "✕ Vehicle is outside the checkpoint area";
            } else if (/belong/i.test(serverMsg) || /wrong/i.test(serverMsg)) {
                displayError = "✕ Wrong Collection Zone";
            } else if (/time/i.test(serverMsg) || /dwell/i.test(serverMsg)) {
                displayError = "✕ Collection time not completed";
            } else if (/already/i.test(serverMsg) || /duplicate/i.test(serverMsg)) {
                displayError = "✕ Checkpoint already verified";
            } else {
                displayError = `✕ ${serverMsg}`;
            }

            setScanResult({
                success: false,
                title: "Scan Failed",
                message: displayError,
                details: serverMsg
            });

            // Automatically resume scanning after 2.5 seconds on failure
            setTimeout(() => {
                setVerifying(false);
                setScanResult(null);
                isScanningRef.current = true;
            }, 2600);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "#000000",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontFamily: "'Inter', sans-serif"
        }}>
            {/* FULLSCREEN CAMERA SCANNER VIEWPORT */}
            <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                
                {/* Html5Qrcode video container */}
                <div
                    id="fullscreen-qr-reader"
                    style={{
                        position: "absolute",
                        top: 0, left: 0, width: "100%", height: "100%",
                        objectFit: "cover"
                    }}
                />

                {/* TOP APP BAR (PhonePe / Google Pay Style) */}
                <div style={{
                    position: "relative",
                    zIndex: 20,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "18px 20px",
                    background: "linear-gradient(180deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)"
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            background: "rgba(255,255,255,0.2)",
                            backdropFilter: "blur(8px)",
                            border: "none",
                            color: "#ffffff",
                            width: "42px",
                            height: "42px",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "20px",
                            cursor: "pointer"
                        }}
                    >
                        ←
                    </button>

                    <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "16px", fontWeight: "800", color: "#ffffff", letterSpacing: "0.3px" }}>
                            Scan Checkpoint
                        </div>
                        <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                            {cp?.name} • {cp?.ward}
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: "10px" }}>
                        {torchSupported && (
                            <button
                                onClick={toggleTorch}
                                style={{
                                    background: torchOn ? "#eab308" : "rgba(255,255,255,0.2)",
                                    color: torchOn ? "#000000" : "#ffffff",
                                    backdropFilter: "blur(8px)",
                                    border: "none",
                                    width: "42px",
                                    height: "42px",
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "18px",
                                    cursor: "pointer"
                                }}
                            >
                                🔦
                            </button>
                        )}

                        {cameras.length > 1 && (
                            <button
                                onClick={flipCamera}
                                style={{
                                    background: "rgba(255,255,255,0.2)",
                                    backdropFilter: "blur(8px)",
                                    border: "none",
                                    color: "#ffffff",
                                    width: "42px",
                                    height: "42px",
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "18px",
                                    cursor: "pointer"
                                }}
                            >
                                🔄
                            </button>
                        )}
                    </div>
                </div>

                {/* CENTER SCANNING VIEWFINDER FRAME */}
                <div style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    zIndex: 10
                }}>
                    {/* Viewfinder Target Box */}
                    <div style={{
                        position: "relative",
                        width: "270px",
                        height: "270px",
                        boxShadow: "0 0 0 4000px rgba(0, 0, 0, 0.55)",
                        borderRadius: "24px"
                    }}>
                        {/* 4 Glowing Corner Accents */}
                        {/* Top-Left */}
                        <div style={{ position: "absolute", top: "-2px", left: "-2px", width: "36px", height: "36px", borderTop: "4px solid #10b981", borderLeft: "4px solid #10b981", borderTopLeftRadius: "20px" }} />
                        {/* Top-Right */}
                        <div style={{ position: "absolute", top: "-2px", right: "-2px", width: "36px", height: "36px", borderTop: "4px solid #10b981", borderRight: "4px solid #10b981", borderTopRightRadius: "20px" }} />
                        {/* Bottom-Left */}
                        <div style={{ position: "absolute", bottom: "-2px", left: "-2px", width: "36px", height: "36px", borderBottom: "4px solid #10b981", borderLeft: "4px solid #10b981", borderBottomLeftRadius: "20px" }} />
                        {/* Bottom-Right */}
                        <div style={{ position: "absolute", bottom: "-2px", right: "-2px", width: "36px", height: "36px", borderBottom: "4px solid #10b981", borderRight: "4px solid #10b981", borderBottomRightRadius: "20px" }} />

                        {/* Animated Laser Scanline */}
                        {scannerActive && !verifying && !scanResult && (
                            <div style={{
                                position: "absolute",
                                left: "12px",
                                right: "12px",
                                height: "3px",
                                background: "linear-gradient(90deg, rgba(16,185,129,0) 0%, rgba(16,185,129,1) 50%, rgba(16,185,129,0) 100%)",
                                boxShadow: "0 0 12px #10b981",
                                animation: "scanLaser 2.2s infinite ease-in-out",
                                borderRadius: "2px"
                            }} />
                        )}
                    </div>

                    {/* Instruction Caption below scanner */}
                    <div style={{ marginTop: "24px", textAlign: "center", padding: "0 20px" }}>
                        <div style={{ color: "#ffffff", fontSize: "15px", fontWeight: "700", textShadow: "0 2px 8px rgba(0,0,0,0.8)" }}>
                            Point camera at physical checkpoint QR
                        </div>
                        {nextPendingCheckpoint && (
                            <div style={{
                                marginTop: "8px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                backgroundColor: "rgba(15, 23, 42, 0.8)",
                                border: "1px solid rgba(56, 189, 248, 0.4)",
                                padding: "5px 14px",
                                borderRadius: "20px",
                                color: "#38bdf8",
                                fontSize: "12px",
                                fontWeight: "700"
                            }}>
                                <span>🎯 Target:</span>
                                <strong style={{ color: "#ffffff" }}>{nextPendingCheckpoint.name}</strong>
                                <span>({nextPendingCheckpoint.scanner_code})</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* BOTTOM ACTION BAR */}
                <div style={{
                    position: "relative",
                    zIndex: 20,
                    padding: "20px",
                    background: "linear-gradient(0deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px"
                }}>
                    {!showManualInput ? (
                        <button
                            onClick={() => setShowManualInput(true)}
                            style={{
                                background: "rgba(255,255,255,0.15)",
                                border: "1px solid rgba(255,255,255,0.25)",
                                color: "#ffffff",
                                padding: "8px 18px",
                                borderRadius: "20px",
                                fontSize: "12px",
                                fontWeight: "600",
                                cursor: "pointer",
                                backdropFilter: "blur(6px)"
                            }}
                        >
                            ⌨️ Manual Code Entry Fallback
                        </button>
                    ) : (
                        <div style={{ width: "100%", maxWidth: "340px", display: "flex", gap: "8px" }}>
                            <input
                                type="text"
                                placeholder="e.g. SCN-W12-1-1"
                                value={manualCode}
                                onChange={(e) => setManualCode(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && manualCode.trim()) {
                                        handleCodeDetected(manualCode);
                                    }
                                }}
                                style={{
                                    flex: 1,
                                    padding: "10px 14px",
                                    borderRadius: "10px",
                                    backgroundColor: "rgba(15, 23, 42, 0.9)",
                                    color: "#ffffff",
                                    border: "1px solid #38bdf8",
                                    fontSize: "13px",
                                    fontWeight: "600",
                                    outline: "none"
                                }}
                            />
                            <button
                                onClick={() => {
                                    if (manualCode.trim()) handleCodeDetected(manualCode);
                                }}
                                disabled={!manualCode.trim() || verifying}
                                style={{
                                    backgroundColor: "#10b981",
                                    color: "#ffffff",
                                    border: "none",
                                    padding: "10px 16px",
                                    borderRadius: "10px",
                                    fontWeight: "800",
                                    fontSize: "13px",
                                    cursor: "pointer"
                                }}
                            >
                                Submit
                            </button>
                        </div>
                    )}
                </div>

                {/* VERIFYING OVERLAY */}
                {verifying && (
                    <div style={{
                        position: "absolute",
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: "rgba(0, 0, 0, 0.82)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 30
                    }}>
                        <div style={{
                            width: "56px",
                            height: "56px",
                            borderRadius: "50%",
                            border: "4px solid rgba(56, 189, 248, 0.2)",
                            borderTop: "4px solid #38bdf8",
                            animation: "spin 0.8s infinite linear",
                            marginBottom: "16px"
                        }} />
                        <div style={{ color: "#ffffff", fontSize: "17px", fontWeight: "800" }}>
                            Validating Checkpoint...
                        </div>
                        <div style={{ color: "#94a3b8", fontSize: "13px", marginTop: "4px" }}>
                            Verifying GPS coordinates & dwell timer
                        </div>
                    </div>
                )}

                {/* SUCCESS STATE OVERLAY (PhonePe Style) */}
                {scanResult && scanResult.success && (
                    <div style={{
                        position: "absolute",
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: "rgba(6, 78, 59, 0.96)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "30px",
                        textAlign: "center",
                        zIndex: 40,
                        animation: "fadeIn 0.25s ease"
                    }}>
                        <div style={{
                            width: "80px",
                            height: "80px",
                            borderRadius: "50%",
                            backgroundColor: "#10b981",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "44px",
                            fontWeight: "900",
                            boxShadow: "0 0 30px rgba(16, 185, 129, 0.6)",
                            marginBottom: "18px"
                        }}>
                            ✓
                        </div>

                        <div style={{ color: "#6ee7b7", fontSize: "13px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "1px" }}>
                            {scanResult.title}
                        </div>
                        <div style={{ color: "#ffffff", fontSize: "24px", fontWeight: "900", marginTop: "4px" }}>
                            {scanResult.zoneName}
                        </div>
                        <div style={{ color: "#a7f3d0", fontSize: "18px", fontWeight: "700", marginTop: "4px" }}>
                            {scanResult.scannerName}
                        </div>

                        <div style={{
                            marginTop: "20px",
                            backgroundColor: "rgba(0,0,0,0.3)",
                            border: "1px solid rgba(110, 231, 183, 0.3)",
                            padding: "10px 24px",
                            borderRadius: "14px"
                        }}>
                            <div style={{ fontSize: "12px", color: "#a7f3d0", fontWeight: "700", textTransform: "uppercase" }}>
                                PROGRESS
                            </div>
                            <div style={{ fontSize: "22px", fontWeight: "900", color: "#ffffff", marginTop: "2px" }}>
                                {scanResult.progress}
                            </div>
                        </div>

                        <div style={{ color: "#d1fae5", fontSize: "12px", marginTop: "16px" }}>
                            Verified at {scanResult.time} • Returning to dashboard...
                        </div>
                    </div>
                )}

                {/* FAILED SCAN OVERLAY */}
                {scanResult && !scanResult.success && (
                    <div style={{
                        position: "absolute",
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: "rgba(127, 29, 29, 0.96)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "30px",
                        textAlign: "center",
                        zIndex: 40,
                        animation: "fadeIn 0.25s ease"
                    }}>
                        <div style={{
                            width: "74px",
                            height: "74px",
                            borderRadius: "50%",
                            backgroundColor: "#dc2626",
                            color: "#ffffff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "38px",
                            fontWeight: "900",
                            boxShadow: "0 0 25px rgba(220, 38, 38, 0.6)",
                            marginBottom: "16px"
                        }}>
                            ✕
                        </div>

                        <div style={{ color: "#ffffff", fontSize: "20px", fontWeight: "900" }}>
                            {scanResult.message}
                        </div>

                        {scanResult.details && scanResult.details !== scanResult.message && (
                            <div style={{ color: "#fecaca", fontSize: "13px", marginTop: "8px", maxWidth: "340px", lineHeight: "1.4" }}>
                                {scanResult.details}
                            </div>
                        )}

                        <div style={{ marginTop: "24px", color: "#fca5a5", fontSize: "12px" }}>
                            Point camera at the correct physical checkpoint QR to retry.
                        </div>

                        <button
                            onClick={() => {
                                setScanResult(null);
                                setVerifying(false);
                                isScanningRef.current = true;
                            }}
                            style={{
                                marginTop: "14px",
                                backgroundColor: "#ffffff",
                                color: "#991b1b",
                                border: "none",
                                padding: "9px 20px",
                                borderRadius: "8px",
                                fontWeight: "800",
                                fontSize: "13px",
                                cursor: "pointer"
                            }}
                        >
                            Retry Now
                        </button>
                    </div>
                )}

                {/* CAMERA PERMISSION ERROR BANNER */}
                {cameraError && (
                    <div style={{
                        position: "absolute",
                        top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: "#0f172a",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "30px",
                        textAlign: "center",
                        zIndex: 50
                    }}>
                        <div style={{ fontSize: "48px", marginBottom: "12px" }}>📷⚠️</div>
                        <div style={{ color: "#ffffff", fontSize: "18px", fontWeight: "800" }}>
                            Camera Access Required
                        </div>
                        <div style={{ color: "#f87171", fontSize: "13px", fontWeight: "600", maxWidth: "340px", marginTop: "8px", lineHeight: "1.5" }}>
                            {cameraError}
                        </div>
                        <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                            <button
                                onClick={onClose}
                                style={{
                                    padding: "9px 18px",
                                    backgroundColor: "#334155",
                                    color: "#f8fafc",
                                    border: "none",
                                    borderRadius: "8px",
                                    fontWeight: "700",
                                    fontSize: "13px",
                                    cursor: "pointer"
                                }}
                            >
                                Back
                            </button>
                            <button
                                onClick={() => startScanner()}
                                style={{
                                    padding: "9px 20px",
                                    backgroundColor: "#2563eb",
                                    color: "#ffffff",
                                    border: "none",
                                    borderRadius: "8px",
                                    fontWeight: "700",
                                    fontSize: "13px",
                                    cursor: "pointer"
                                }}
                            >
                                🔄 Retry Camera
                            </button>
                        </div>
                    </div>
                )}

            </div>

            {/* Embedded CSS for scanline animation */}
            <style>{`
                @keyframes scanLaser {
                    0% { top: 10px; opacity: 0.8; }
                    50% { top: 250px; opacity: 1; }
                    100% { top: 10px; opacity: 0.8; }
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
}

export default CheckpointQRScannerModal;
