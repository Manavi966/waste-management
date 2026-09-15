import { useState } from "react";

import Login from "./pages/Login";
import CitizenDashboard from "./dashboards/CitizenDashboard";
import DriverDashboard from "./dashboards/DriverDashboard";
import AuthorityDashboard from "./dashboards/AuthorityDashboard";

function App() {
    const [isLoggedIn, setIsLoggedIn] = useState(
        !!localStorage.getItem("token")
    );

    if (!isLoggedIn) {
        return (
            <Login
                onLogin={() => setIsLoggedIn(true)}
            />
        );
    }

    const storedUser = localStorage.getItem("user");

    if (!storedUser) {
        localStorage.removeItem("token");
        return (
            <Login
                onLogin={() => setIsLoggedIn(true)}
            />
        );
    }

    const user = JSON.parse(storedUser);

    if (user.role === "CITIZEN") {
        return <CitizenDashboard user={user} />;
    }

    if (user.role === "DRIVER") {
        return <DriverDashboard user={user} />;
    }

    if (user.role === "AUTHORITY") {
        return <AuthorityDashboard user={user} />;
    }

    return <Login onLogin={() => setIsLoggedIn(true)} />;
}

export default App;