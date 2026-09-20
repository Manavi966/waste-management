import { useState } from "react";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import CitizenDashboard from "./dashboards/CitizenDashboard";
import DriverDashboard from "./dashboards/DriverDashboard";
import AuthorityDashboard from "./dashboards/AuthorityDashboard";

function App() {
    const [user, setUser] = useState(() => {
        const stored = localStorage.getItem("user");
        return stored ? JSON.parse(stored) : null;
    });
    const [view, setView] = useState(() => {
        return localStorage.getItem("token") ? "DASHBOARD" : "LANDING";
    });
    const [selectedRole, setSelectedRole] = useState("AUTHORITY");

    const handleLoginSuccess = (userData) => {
        setUser(userData);
        setView("DASHBOARD");
    };

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setUser(null);
        setView("LANDING");
    };

    const handleSelectRoleFromLanding = (role) => {
        setSelectedRole(role);
        setView("LOGIN");
    };

    if (view === "LANDING" && !user) {
        return <LandingPage onSelectRole={handleSelectRoleFromLanding} />;
    }

    if ((view === "LOGIN" || !user)) {
        return (
            <Login
                initialRole={selectedRole}
                onLogin={handleLoginSuccess}
                onBackToLanding={() => setView("LANDING")}
            />
        );
    }

    if (user.role === "CITIZEN") {
        return <CitizenDashboard user={user} onLogout={handleLogout} />;
    }

    if (user.role === "DRIVER") {
        return <DriverDashboard user={user} onLogout={handleLogout} />;
    }

    if (user.role === "AUTHORITY") {
        return <AuthorityDashboard user={user} onLogout={handleLogout} />;
    }

    return <LandingPage onSelectRole={handleSelectRoleFromLanding} />;
}

export default App;