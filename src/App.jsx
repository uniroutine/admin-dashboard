// src/App.jsx
import React from "react";
import { MemoryRouter as Router, Routes, Route, Link } from "react-router-dom";
import "./App.css";

// Your existing page components
import Home from "./components/home";
import RoutineManager from "./components/RoutineManager";
import AboutUs from "./components/AboutUs";
import AddData from "./components/AddData";

// Auth pieces (ensure these files exist)
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import RequireAuth from "./components/RequireAuth";
import Login from "./components/Login";

// signOut helper
import { signOut } from "firebase/auth";
import { auth } from "./firebase";

export default function App() {
  return (
    <AuthProvider>
    {/* MemoryRouter keeps the browser URL unchanged while still providing routing in-memory */}
    <Router>
    <AppRoutes />
    </Router>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading" style={{ padding: 24, textAlign: "center" }}>
      Checking authentication…
      </div>
    );
  }

  return (
    <>
    {/* Show nav only when authenticated */}
    {user && <MainNav onSignOut={() => signOut(auth)} />}

    <div className="app-container">
    <Routes>
    {/* Public login route (still in-memory) */}
    <Route path="/login" element={<Login />} />

    {/* Protected routes (RequireAuth uses in-memory location) */}
    <Route element={<RequireAuth />}>
    <Route path="/add-data" element={<AddData />} />
    <Route path="/" element={<Home />} />
    <Route path="/edit-routine" element={<RoutineManager />} />
    <Route path="/about-us" element={<AboutUs />} />
    </Route>

    {/* Fallback: if user is authenticated show Home, otherwise RequireAuth redirects to /login */}
    <Route path="*" element={<RequireAuth><Home /></RequireAuth>} />
    </Routes>
    </div>
    </>
  );
}

function MainNav({ onSignOut }) {
  return (
    <nav className="navbar" aria-label="Primary navigation">
    <ul>
    <li><Link to="/">Home</Link></li>
    <li><Link to="/add-data">Add Data</Link></li>
    <li><Link to="/edit-routine">Edit Routine</Link></li>
    <li><Link to="/about-us">About Us</Link></li>
    <li style={{ marginLeft: 12 }}>
    <button
    onClick={onSignOut}
    style={{
      border: "none",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      padding: 6,
      fontSize: "0.95rem"
    }}
    >
    Sign out
    </button>
    </li>
    </ul>
    </nav>
  );
}
