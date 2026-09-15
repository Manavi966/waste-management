import { useEffect, useState } from "react";
import {
    MapContainer,
    TileLayer,
    Marker,
    Popup
} from "react-leaflet";

import L from "leaflet";
import api from "../services/api";

import "leaflet/dist/leaflet.css";

// Fix Leaflet marker icons
delete L.Icon.Default.prototype._getIconUrl;

L.Icon.Default.mergeOptions({
    iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",

    iconUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",

    shadowUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png"
});


function LiveMap() {

    const [vehicles, setVehicles] = useState([]);
    const [error, setError] = useState("");


    const fetchLocations = async () => {

        try {

            const response = await api.get(
                "/gps/latest"
            );

            setVehicles(response.data);
            setError("");

        } catch (error) {

            console.error(
                "Failed to fetch vehicle locations:",
                error
            );

            setError(
                "Unable to load vehicle locations."
            );
        }
    };


    useEffect(() => {

        // Load immediately
        fetchLocations();

        // Update every 5 seconds
        const interval = setInterval(
            fetchLocations,
            5000
        );

        return () => clearInterval(interval);

    }, []);


    if (error) {
        return (
            <p style={{ color: "red" }}>
                {error}
            </p>
        );
    }


    if (vehicles.length === 0) {
        return (
            <div>
                <h2>🗺️ Live Vehicle Location</h2>

                <p>
                    No vehicle GPS locations available.
                </p>
            </div>
        );
    }


    // Use first vehicle as initial map center
    const firstVehicle = vehicles[0];

    const center = [
        Number(firstVehicle.latitude),
        Number(firstVehicle.longitude)
    ];


    return (

        <div>

            <h2>
                🗺️ Live Vehicle Locations
            </h2>

            <p>
                🚛 Vehicles currently reporting GPS:{" "}
                <strong>
                    {vehicles.length}
                </strong>
            </p>


            <MapContainer
                center={center}
                zoom={13}
                style={{
                    height: "500px",
                    width: "100%",
                    borderRadius: "10px"
                }}
            >

                <TileLayer
                    attribution='&copy; OpenStreetMap contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />


                {vehicles.map((vehicle) => {

                    const position = [
                        Number(vehicle.latitude),
                        Number(vehicle.longitude)
                    ];


                    return (

                        <Marker
                            key={vehicle.vehicle_id}
                            position={position}
                        >

                            <Popup>

                                <h3>
                                    🚛{" "}
                                    {vehicle.vehicle_number}
                                </h3>

                                <p>
                                    <strong>
                                        Vehicle ID:
                                    </strong>{" "}
                                    {vehicle.vehicle_id}
                                </p>

                                <p>
                                    <strong>
                                        Status:
                                    </strong>{" "}
                                    {vehicle.status}
                                </p>

                                <p>
                                    📍{" "}
                                    <strong>
                                        Latitude:
                                    </strong>{" "}
                                    {Number(
                                        vehicle.latitude
                                    ).toFixed(6)}
                                </p>

                                <p>
                                    📍{" "}
                                    <strong>
                                        Longitude:
                                    </strong>{" "}
                                    {Number(
                                        vehicle.longitude
                                    ).toFixed(6)}
                                </p>

                                <p>
                                    🚗{" "}
                                    <strong>
                                        Speed:
                                    </strong>{" "}
                                    {Number(
                                        vehicle.speed
                                    ).toFixed(2)}{" "}
                                    km/h
                                </p>

                                <p>
                                    🕐{" "}
                                    <strong>
                                        Last Update:
                                    </strong>{" "}
                                    {new Date(
                                        vehicle.recorded_at
                                    ).toLocaleTimeString()}
                                </p>

                            </Popup>

                        </Marker>

                    );

                })}

            </MapContainer>

        </div>
    );
}


export default LiveMap;