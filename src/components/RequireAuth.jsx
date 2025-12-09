// src/components/RequireAuth.jsx
import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function RequireAuth({ children }) {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return <div style={{padding:20}}>Checking authentication…</div>;
    }

    if (!user) {
        // redirect to /login and save where the user wanted to go
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return children ?? <Outlet />;
}
