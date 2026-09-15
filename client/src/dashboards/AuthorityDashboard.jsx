import { useEffect, useState } from "react";
import api from "../services/api";
import LiveMap from "../components/LiveMap";

function AuthorityDashboard({ user }) {

    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchDashboard = async () => {
        try {

            const response = await api.get(
                "/admin/dashboard"
            );

            setDashboard(response.data);

        } catch (error) {

            console.error(error);

            setError(
                "Failed to load authority dashboard."
            );

        } finally {

            setLoading(false);
        }
    };


    useEffect(() => {

        fetchDashboard();

    }, []);


    if (loading) {
        return (
            <h2>
                Loading Authority Dashboard...
            </h2>
        );
    }


    if (error) {
        return (
            <h2>
                {error}
            </h2>
        );
    }


    if (!dashboard) {
        return (
            <h2>
                No dashboard data available.
            </h2>
        );
    }


    const vehicles = dashboard.vehicles;
    const collections = dashboard.collections;
    const missedLocations =
        dashboard.missed_locations;


    return (

        <div
            style={{
                padding: "30px",
                fontFamily: "Arial"
            }}
        >

            {/* HEADER */}

            <h1>
                🏛️ Authority Dashboard
            </h1>

            <h2>
                Welcome, {user.name}
            </h2>

            <hr />


            {/* VEHICLE SUMMARY */}

            <h2>
                🚛 Vehicle Summary
            </h2>


            <div
                style={{
                    display: "flex",
                    gap: "15px",
                    flexWrap: "wrap"
                }}
            >

                <div
                    style={{
                        padding: "20px",
                        border: "1px solid #ccc",
                        borderRadius: "10px",
                        minWidth: "150px"
                    }}
                >
                    <h3>
                        🚛 Total Vehicles
                    </h3>

                    <h2>
                        {vehicles.total_vehicles}
                    </h2>
                </div>


                <div
                    style={{
                        padding: "20px",
                        border: "1px solid #ccc",
                        borderRadius: "10px",
                        minWidth: "150px"
                    }}
                >
                    <h3>
                        🟢 Active
                    </h3>

                    <h2>
                        {vehicles.active_vehicles}
                    </h2>
                </div>


                <div
                    style={{
                        padding: "20px",
                        border: "1px solid #ccc",
                        borderRadius: "10px",
                        minWidth: "150px"
                    }}
                >
                    <h3>
                        ⚪ Available
                    </h3>

                    <h2>
                        {vehicles.available_vehicles}
                    </h2>
                </div>


                <div
                    style={{
                        padding: "20px",
                        border: "1px solid #ccc",
                        borderRadius: "10px",
                        minWidth: "150px"
                    }}
                >
                    <h3>
                        🔴 Inactive
                    </h3>

                    <h2>
                        {vehicles.inactive_vehicles}
                    </h2>
                </div>

            </div>


            

            <hr />

                <LiveMap />
                <hr />


            {/* COLLECTION SUMMARY */}

            <h2>
                📍 Collection Summary
            </h2>

            <div
                style={{
                    display: "flex",
                    gap: "15px",
                    flexWrap: "wrap"
                }}
            >

                <div
                    style={{
                        padding: "20px",
                        backgroundColor: "#d4edda",
                        borderRadius: "10px",
                        minWidth: "150px"
                    }}
                >
                    <h3>
                        🟢 Completed
                    </h3>

                    <h2>
                        {collections.completed_stops}
                    </h2>
                </div>


                <div
                    style={{
                        padding: "20px",
                        backgroundColor: "#fff3cd",
                        borderRadius: "10px",
                        minWidth: "150px"
                    }}
                >
                    <h3>
                        🟡 Pending
                    </h3>

                    <h2>
                        {collections.pending_stops}
                    </h2>
                </div>


                <div
                    style={{
                        padding: "20px",
                        backgroundColor: "#f8d7da",
                        borderRadius: "10px",
                        minWidth: "150px"
                    }}
                >
                    <h3>
                        🔴 Missed
                    </h3>

                    <h2>
                        {collections.missed_stops}
                    </h2>
                </div>

            </div>


            <hr />


            {/* MISSED LOCATIONS */}

            <h2>
                🔴 Missed Collection Locations
            </h2>


            {missedLocations.length === 0 ? (

                <p>
                    🎉 No missed collection points.
                </p>

            ) : (

                missedLocations.map((location) => (

                    <div
                        key={location.id}
                        style={{
                            border: "1px solid #dc3545",
                            padding: "20px",
                            marginBottom: "15px",
                            borderRadius: "10px",
                            backgroundColor: "#fff5f5"
                        }}
                    >

                        <h3>
                            🔴 {location.collection_point}
                        </h3>

                        <p>
                            📍 {location.address}
                        </p>

                        <p>
                            🚛 <strong>
                                Vehicle:
                            </strong>{" "}
                            {location.vehicle_number}
                        </p>

                        <p>
                            🔢 <strong>
                                Stop:
                            </strong>{" "}
                            {location.sequence}
                        </p>

                        <p>
                            ❌ <strong>
                                Reason:
                            </strong>{" "}
                            {location.miss_reason}
                        </p>

                    </div>

                ))

            )}


            <hr />


            {/* REFRESH */}

            <button
                onClick={fetchDashboard}
                style={{
                    padding: "12px 20px",
                    cursor: "pointer"
                }}
            >
                🔄 Refresh Dashboard
            </button>

        </div>

    );
}


export default AuthorityDashboard;