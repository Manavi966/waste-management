function CitizenDashboard({ user }) {
    return (
        <div>
            <h1>Citizen Dashboard</h1>

            <h2>Welcome, {user.name}!</h2>

            <p>
                You are logged in as a citizen.
            </p>

            <hr />

            <h3>Citizen Services</h3>

            <button>Report Waste Issue</button>

            <button>My Complaints</button>

            <button>Collection Status</button>
        </div>
    );
}

export default CitizenDashboard;