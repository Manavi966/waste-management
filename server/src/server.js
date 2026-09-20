const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./config/db");
const initAssignmentIntegrity = require("./config/initTrigger");
initAssignmentIntegrity();

const authRoutes = require("./routes/authRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const routeRoutes = require("./routes/routeRoutes");
const gpsRoutes = require("./routes/gpsRoutes");
const adminRoutes = require("./routes/adminRoutes");
const collectionPointRoutes = require("./routes/collectionPointRoutes");
const complaintRoutes = require("./routes/complaintRoutes");
const citizenRoutes = require("./routes/citizenRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/gps", gpsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/collection-points", collectionPointRoutes);
app.use("/api/complaints", complaintRoutes);
app.use("/api/citizen", citizenRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "Smart Waste Management API is running"
    });
});

app.get("/api/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");

        res.json({
            message: "Database connected successfully",
            time: result.rows[0].now
        });
    } catch (error) {
        console.error("Database error:", error);

        res.status(500).json({
            message: "Database connection failed",
            error: error.message
        });
    }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});