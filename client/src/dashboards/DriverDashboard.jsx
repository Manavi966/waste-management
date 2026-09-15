import { useEffect, useState } from "react";
import api from "../services/api";

function DriverDashboard({ user }) {
    const [vehicle, setVehicle] = useState(null);
    const [route, setRoute] = useState(null);
    const [stops, setStops] = useState([]);

    const [gpsStatus, setGpsStatus] = useState("Not started");
    const [currentLocation, setCurrentLocation] = useState(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [updatingStop, setUpdatingStop] = useState(null);

    const fetchDriverData = async () => {
        try {
            const vehicleResponse = await api.get(
                `/vehicles/driver/${user.id}`
            );

            if (vehicleResponse.data.length > 0) {
                setVehicle(vehicleResponse.data[0]);
            }

            const routeResponse = await api.get(
                "/routes/1"
            );

            setRoute(routeResponse.data.route);
            setStops(routeResponse.data.stops);

        } catch (error) {
            console.error(error);
            setError("Failed to load driver information.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchDriverData();
    }, [user.id]);

    const completeStop = async (stopId) => {
    try {
        setUpdatingStop(stopId);

        // Check if browser supports GPS
        if (!navigator.geolocation) {
            alert("GPS is not supported by this browser.");
            return;
        }

        // Get driver's current GPS position
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const latitude = position.coords.latitude;
                const longitude = position.coords.longitude;

                try {
                    const response = await api.post(
                        `/routes/stops/${stopId}/complete`,
                        {
                            latitude,
                            longitude
                        }
                    );

                    alert(response.data.message);

                    // Refresh route
                    await fetchDriverData();

                } catch (error) {
                    console.error(error);

                    const message =
                        error.response?.data?.message ||
                        "Unable to complete collection point.";

                    alert(message);
                } finally {
                    setUpdatingStop(null);
                }
            },
            (error) => {
                console.error("GPS error:", error);

                alert(
                    "Unable to get your current location. Please enable GPS."
                );

                setUpdatingStop(null);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 5000
            }
        );

    } catch (error) {
        console.error(error);
        setUpdatingStop(null);
    }
};

const markStopAsMissed = async (stopId) => {
    const reason = window.prompt(
        "Why was this location missed?\n\n" +
        "Enter one of:\n" +
        "1. Heavy Traffic\n" +
        "2. Vehicle Breakdown\n" +
        "3. Road Blocked\n" +
        "4. Collection Point Closed\n" +
        "5. Emergency\n" +
        "6. Other"
    );

    if (!reason || reason.trim() === "") {
        return;
    }

    try {
        setUpdatingStop(stopId);

        const response = await api.post(
            `/routes/stops/${stopId}/miss`,
            {
                reason: reason.trim()
            }
        );

        alert(response.data.message);

        await fetchDriverData();

    } catch (error) {
        console.error(error);

        const message =
            error.response?.data?.message ||
            "Failed to mark location as missed.";

        alert(message);

    } finally {
        setUpdatingStop(null);
    }
};

    const startGPSTracking = () => {
    if (!navigator.geolocation) {
        setGpsStatus(
            "GPS is not supported by this browser."
        );
        return;
    }

    if (!vehicle) {
        setGpsStatus(
            "No vehicle assigned."
        );
        return;
    }

    setGpsStatus("Starting GPS...");

    navigator.geolocation.watchPosition(
        async (position) => {

            const latitude =
                position.coords.latitude;

            const longitude =
                position.coords.longitude;

            const speed =
                position.coords.speed !== null
                    ? position.coords.speed * 3.6
                    : 0;

            setCurrentLocation({
                latitude,
                longitude,
                speed
            });

            setGpsStatus(
                "GPS tracking active"
            );

            try {

                await api.post("/gps", {
                    vehicle_id: vehicle.id,
                    latitude,
                    longitude,
                    speed
                });

                console.log(
                    "GPS location sent:",
                    latitude,
                    longitude
                );

            } catch (error) {

                console.error(
                    "Failed to send GPS:",
                    error
                );

                setGpsStatus(
                    "GPS active, but server update failed."
                );
            }
        },

        (error) => {

            console.error(
                "GPS error:",
                error
            );

            setGpsStatus(
                "Unable to access GPS."
            );
        },

        {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 10000
        }
    );
};

    if (loading) {
        return <h2>Loading Driver Dashboard...</h2>;
    }

    if (error) {
        return <h2>{error}</h2>;
    }

    return (
        <div style={{ padding: "30px" }}>

            <h1>🚛 Driver Dashboard</h1>

            <h2>
                Welcome, {user.name}!
            </h2>

            <hr />

            {/* VEHICLE */}

            <h2>Assigned Vehicle</h2>

            {vehicle ? (
                <div>
                    <p>
                        <strong>
                            Vehicle Number:
                        </strong>{" "}
                        {vehicle.vehicle_number}
                    </p>

                    <p>
                        <strong>
                            Vehicle Status:
                        </strong>{" "}
                        {vehicle.status}
                    </p>
                </div>
            ) : (
                <p>No vehicle assigned.</p>
            )}
            <hr />

                <h2>📍 GPS Tracking</h2>

                <p>
                    <strong>Status:</strong>{" "}
                    {gpsStatus}
                </p>

                {currentLocation && (
                    <div>
                        <p>
                            <strong>Latitude:</strong>{" "}
                            {currentLocation.latitude.toFixed(6)}
                        </p>

                        <p>
                            <strong>Longitude:</strong>{" "}
                            {currentLocation.longitude.toFixed(6)}
                        </p>

                        <p>
                            <strong>Speed:</strong>{" "}
                            {currentLocation.speed.toFixed(2)} km/h
                        </p>
                    </div>
                )}

                <button
                    onClick={startGPSTracking}
                    disabled={
                        gpsStatus === "GPS tracking active"
                    }
                >
                    📍 Start GPS Tracking
                </button>

            <hr />

            {/* ROUTE */}

            <h2>Today's Collection Route</h2>

            {route && (
                <div>
                    <p>
                        <strong>Status:</strong>{" "}
                        {route.status}
                    </p>

                    <p>
                        <strong>
                            Total Distance:
                        </strong>{" "}
                        {route.total_distance} km
                    </p>

                    <p>
                        <strong>
                            Estimated Time:
                        </strong>{" "}
                        {route.estimated_time} minutes
                    </p>
                </div>
            )}

            <hr />

            {/* COLLECTION POINTS */}

            <h2>Collection Points</h2>

            {stops.length === 0 ? (
                <p>
                    No collection points assigned.
                </p>
            ) : (
                stops.map((stop) => (
                    <div
                        key={stop.id}
                        style={{
                            border: "1px solid #ccc",
                            padding: "15px",
                            marginBottom: "12px",
                            borderRadius: "8px"
                        }}
                    >

                        <h3>
                            {stop.status === "COMPLETED"
                                ? "🟢"
                                : stop.status === "MISSED"
                                    ? "🔴"
                                    : "🟡"}{" "}
                            Stop {stop.sequence}:{" "}
                            {stop.name}
                        </h3>

                        <p>
                            📍 {stop.address}
                        </p>

                        <p>
                            🕐 Scheduled:{" "}
                            {stop.scheduled_time}
                        </p>

                        <p>
                            <strong>
                                Status:
                            </strong>{" "}
                            {stop.status}
                        </p>
                        {stop.status === "MISSED" &&
                            stop.miss_reason && (
                                <p>
                                    ❌ <strong>Reason:</strong>{" "}
                                    {stop.miss_reason}
                                </p>
                            )}

                        {stop.actual_arrival && (
                            <p>
                                🟢 Arrival:{" "}
                                {new Date(
                                    stop.actual_arrival
                                ).toLocaleTimeString()}
                            </p>
                        )}

                        {stop.actual_departure && (
                            <p>
                                🚛 Departure:{" "}
                                {new Date(
                                    stop.actual_departure
                                ).toLocaleTimeString()}
                            </p>
                        )}

                        {stop.status === "PENDING" && (
    <div>

        <button
            onClick={() =>
                completeStop(stop.id)
            }
            disabled={
                updatingStop === stop.id
            }
            style={{
                padding: "10px 15px",
                marginRight: "10px",
                cursor: "pointer"
            }}
        >
            {updatingStop === stop.id
                ? "Checking GPS..."
                : "✓ Mark as Collected"}
        </button>


        <button
            onClick={() =>
                markStopAsMissed(stop.id)
            }
            disabled={
                updatingStop === stop.id
            }
            style={{
                padding: "10px 15px",
                backgroundColor: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer"
            }}
        >
            {updatingStop === stop.id
                ? "Updating..."
                : "✕ Mark as Missed"}
        </button>

    </div>
)}

                    </div>
                ))
            )}

        </div>
    );
}

export default DriverDashboard;