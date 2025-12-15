// src/App.jsx
import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { MemoryRouter as Router, Routes, Route, Link } from "react-router-dom";
import "./App.css";

// Your existing page components
import Home from "./components/home";
import RoutineManager from "./components/RoutineManager";
import AboutUs from "./components/AboutUs";
import AddData from "./components/AddData";

// Auth pieces (we keep useAuth here; AuthProvider is provided in main.jsx)
import { useAuth } from "./contexts/AuthContext";
import RequireAuth from "./components/RequireAuth";
import Login from "./components/Login";

// signOut helper
import { signOut } from "firebase/auth";
import { auth } from "./firebase";

// OfflineDialog (global) — assumes you created src/components/OfflineDialog.jsx
import OfflineDialog from "./components/OfflineDialog";

export default function App() {
  const lastRoute = sessionStorage.getItem("lastRoute") || "/";
  return (
    <>
    {/* Global offline dialog (renders when offline) */}
    <OfflineDialog />

    {/* MemoryRouter keeps the browser URL unchanged while still providing routing in-memory */}
    <Router initialEntries={[lastRoute]}>
    <RoutePersistence />
    <AppRoutes />
    </Router>
    </>
  );
}

function RoutePersistence() {
  const location = useLocation();

  useEffect(() => {
    sessionStorage.setItem("lastRoute", location.pathname);
  }, [location]);

  return null;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading-page">
      <div className="auth-loading-box">
      <div className="spinner" />
      <div className="auth-loading-text">Checking authentication…</div>
      </div>
      </div>
    );
  }

  return (
    <>
    {/* Show nav only when authenticated */}
    {user && <MainNav onSignOut={() => signOut(auth)} />}
    <div className="app-fade-in">
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
    </div>
    </>
  );
}

/**
 * MainNav
 *
 * Markup intentionally uses a left-aligned set of links and a centered signout button.
 * The center button is positioned absolutely within the nav container so it remains
 * visually centered on the page while the left links remain left-aligned.
 *
 * The CSS (in App.css) makes the nav sticky and applies hover animations.
 */
function MainNav({ onSignOut }) {
  return (
    <nav className="navbar" aria-label="Primary navigation">
    <div className="nav-inner">
    <div className="nav-left">
    <ul className="nav-links">
    <li><Link to="/">Home</Link></li>
    <li><Link to="/add-data">Add Data</Link></li>
    <li><Link to="/edit-routine">Edit Routine</Link></li>
    <li><Link to="/about-us">About Us</Link></li>
    </ul>
    </div>

    {/* centered signout button (visually centered across screen) */}
    <div className="nav-center">
    <button className="signout-btn" onClick={onSignOut} aria-label="Sign out">
    Sign out
    </button>
    </div>

    {/* right placeholder (keeps layout symmetrical and prevents overlaps) */}
    <div className="nav-right" aria-hidden="true" />
    </div>
    </nav>
  );
}
