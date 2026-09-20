const pool = require("./db");

async function initAssignmentIntegrity() {
    try {
        await pool.query(`
            CREATE OR REPLACE FUNCTION verify_collection_point_date_unique()
            RETURNS TRIGGER AS $$
            DECLARE
                target_date DATE;
                existing_veh_num VARCHAR;
            BEGIN
                SELECT route_date INTO target_date FROM routes WHERE id = NEW.route_id;
                
                IF target_date IS NOT NULL THEN
                    SELECT v.vehicle_number INTO existing_veh_num
                    FROM route_stops rs
                    JOIN routes r ON rs.route_id = r.id
                    JOIN vehicles v ON r.vehicle_id = v.id
                    WHERE rs.collection_point_id = NEW.collection_point_id
                      AND r.route_date = target_date
                      AND r.id != NEW.route_id
                    LIMIT 1;

                    IF existing_veh_num IS NOT NULL THEN
                        RAISE EXCEPTION 'Collection point % is already assigned to vehicle % for date %', 
                            NEW.collection_point_id, existing_veh_num, target_date;
                    END IF;
                END IF;

                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trg_verify_collection_point_date_unique ON route_stops;

            CREATE TRIGGER trg_verify_collection_point_date_unique
            BEFORE INSERT OR UPDATE OF collection_point_id, route_id
            ON route_stops
            FOR EACH ROW
            EXECUTE FUNCTION verify_collection_point_date_unique();
        `);
        console.log("✓ PostgreSQL Collection Point Date Uniqueness Trigger successfully configured.");
    } catch (err) {
        console.error("Failed to initialize trigger:", err);
    }
}

module.exports = initAssignmentIntegrity;
