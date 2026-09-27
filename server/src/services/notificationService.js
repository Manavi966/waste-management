const pool = require("../config/db");

/**
 * Creates an in-app notification and logs the event to activity_logs
 */
async function createNotification({
    recipient_role = "ALL",
    user_id = null,
    ward = null,
    title,
    message,
    type = "INFO",
    vehicle_id = null
}, dbPool = pool) {
    try {
        const result = await dbPool.query(`
            INSERT INTO notifications 
            (recipient_role, user_id, ward, title, message, type, vehicle_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
            RETURNING *
        `, [recipient_role, user_id, ward, title, message, type, vehicle_id]);

        return result.rows[0];
    } catch (err) {
        console.error("Error creating notification:", err);
        return null;
    }
}

/**
 * Handles all notifications when a vehicle enters MAINTENANCE status
 */
async function handleVehicleMaintenanceEvent(vehicleId, vehicleNumber, ward, dbPool = pool) {
    try {
        // 1. Citizen notification (Area-specific)
        if (ward) {
            await createNotification({
                recipient_role: "CITIZEN",
                ward: ward,
                title: `Waste Collection Notice • ${ward}`,
                message: `Your area's waste collection vehicle is currently under maintenance and will not be able to collect waste today. Please check the app for further updates.`,
                type: "MAINTENANCE_ALERT",
                vehicle_id: vehicleId
            }, dbPool);
        }

        // 2. Higher Authority notification
        await createNotification({
            recipient_role: "AUTHORITY",
            ward: ward,
            title: `⚠ Vehicle Maintenance Alert • ${vehicleNumber}`,
            message: `Vehicle ${vehicleNumber}${ward ? ` assigned to ${ward}` : ""} is under maintenance and is unavailable for today's waste collection. Replacement vehicle assignment is required.`,
            type: "MAINTENANCE_ALERT",
            vehicle_id: vehicleId
        }, dbPool);

        // 3. Activity Log
        await dbPool.query(`
            INSERT INTO activity_logs (event_type, description, vehicle_id)
            VALUES ($1, $2, $3)
        `, [
            "VEHICLE_MAINTENANCE",
            `Vehicle ${vehicleNumber} (${ward || "Unassigned"}) marked as MAINTENANCE. Citizen & Authority alerts dispatched.`,
            vehicleId
        ]);
    } catch (err) {
        console.error("Error handling vehicle maintenance event:", err);
    }
}

/**
 * Handles notifications when Authority selects a replacement vehicle for an area
 */
async function handleReplacementAssignedEvent({
    maintenanceVehicleId,
    maintenanceVehicleNumber,
    replacementVehicleId,
    replacementVehicleNumber,
    ward,
    startDate,
    endDate
}, dbPool = pool) {
    try {
        // 1. Citizen notification
        if (ward) {
            await createNotification({
                recipient_role: "CITIZEN",
                ward: ward,
                title: `Replacement Vehicle Assigned • ${ward}`,
                message: `Your regular collection vehicle is under maintenance. A replacement vehicle has been assigned for today's collection.`,
                type: "REPLACEMENT_ASSIGNED",
                vehicle_id: replacementVehicleId
            }, dbPool);
        }

        // 2. Higher Authority notification
        await createNotification({
            recipient_role: "AUTHORITY",
            ward: ward,
            title: `Replacement Confirmed • ${ward}`,
            message: `Replacement vehicle ${replacementVehicleNumber} temporarily assigned to ${ward} covering for ${maintenanceVehicleNumber}.`,
            type: "REPLACEMENT_ASSIGNED",
            vehicle_id: replacementVehicleId
        }, dbPool);

        // 3. Activity Log
        await dbPool.query(`
            INSERT INTO activity_logs (event_type, description, vehicle_id)
            VALUES ($1, $2, $3)
        `, [
            "REPLACEMENT_ASSIGNED",
            `Authority assigned replacement vehicle ${replacementVehicleNumber} to cover ${ward} (regular vehicle ${maintenanceVehicleNumber} under maintenance).`,
            replacementVehicleId
        ]);
    } catch (err) {
        console.error("Error handling replacement assigned event:", err);
    }
}

/**
 * Handles notifications when a maintenance vehicle returns to service
 */
async function handleVehicleReturnedToServiceEvent(vehicleId, vehicleNumber, ward, dbPool = pool) {
    try {
        // 1. Citizen notification
        if (ward) {
            await createNotification({
                recipient_role: "CITIZEN",
                ward: ward,
                title: `Waste Collection Resumed • ${ward}`,
                message: `Vehicle ${vehicleNumber} has returned to service and regular waste collection in ${ward} has resumed.`,
                type: "SERVICE_RESTORED",
                vehicle_id: vehicleId
            }, dbPool);
        }

        // 2. Authority notification
        await createNotification({
            recipient_role: "AUTHORITY",
            ward: ward,
            title: `Vehicle Returned to Service • ${vehicleNumber}`,
            message: `Vehicle ${vehicleNumber} returned to service in ${ward}. Permanent assignment restored and temporary replacement ended.`,
            type: "SERVICE_RESTORED",
            vehicle_id: vehicleId
        }, dbPool);

        // 3. Activity Log
        await dbPool.query(`
            INSERT INTO activity_logs (event_type, description, vehicle_id)
            VALUES ($1, $2, $3)
        `, [
            "VEHICLE_SERVICE_RESTORED",
            `Vehicle ${vehicleNumber} restored to IN_SERVICE. Permanent area ${ward} resumed.`,
            vehicleId
        ]);
    } catch (err) {
        console.error("Error handling service restore event:", err);
    }
}

module.exports = {
    createNotification,
    handleVehicleMaintenanceEvent,
    handleReplacementAssignedEvent,
    handleVehicleReturnedToServiceEvent
};
