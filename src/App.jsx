import React, { useEffect, useState } from "react";
import {
  MemoryRouter,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import "./App.css";

// Pages
import Home from "./components/home";
import RoutineManager from "./components/RoutineManager";
import FacultyRoutine from "./components/FacultyRoutine";
import AboutUs from "./components/AboutUs";
import AddData from "./components/AddData";

// Auth
import { useAuth } from "./contexts/AuthContext";
import RequireAuth from "./components/RequireAuth";
import Login from "./components/Login";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";

// Offline
import OfflineDialog from "./components/OfflineDialog";

export default function App() {
  const lastRoute = sessionStorage.getItem("lastRoute") || "/";

  return (
    <>
      <OfflineDialog />
      <MemoryRouter initialEntries={[lastRoute]}>
        <RoutePersistence />
        <AppRoutes />
      </MemoryRouter>
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
          <div className="auth-loading-text">
            Checking authentication…
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {user && <MainNav onSignOut={() => signOut(auth)} />}

      <div className="app-fade-in">
        <div className="app-container">
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<RequireAuth />}>
              <Route path="/" element={<Home />} />
              <Route path="/add-data" element={<AddData />} />
              <Route path="/edit-routine" element={<RoutineManager />} />
              <Route path="/faculty-routine" element={<FacultyRoutine />} />
              <Route path="/about-us" element={<AboutUs />} />
            </Route>

            <Route
              path="*"
              element={
                <RequireAuth>
                  <Home />
                </RequireAuth>
              }
            />
          </Routes>
        </div>
      </div>
    </>
  );
}

function MainNav({ onSignOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="navbar">
      <div className="nav-left hideOnMobile" />

      <div className="nav-center">
        <ul className="nav-links">
          <li className="hideOnMobile">
            <Link to="/">Home</Link>
          </li>
          <li className="hideOnMobile">
            <Link to="/add-data">Add Data</Link>
          </li>
          <li className="hideOnMobile">
            <Link to="/edit-routine">Student Routine</Link>
          </li>
          <li className="hideOnMobile">
          <Link to="/faculty-routine">Faculty Routine</Link>
          </li>
          <li className="hideOnMobile">
            <Link to="/about-us">About Us</Link>
          </li>
        </ul>
      </div>

      <div className="nav-right">
        <button
          className="signout-btn hideOnMobile"
          onClick={onSignOut}
        >
          Sign out
        </button>

        <button
          className={`hamburger-btn showOnMobile ${
            menuOpen ? "open" : ""
          }`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span className="hamburger-bar" />
          <span className="hamburger-bar" />
          <span className="hamburger-bar" />
        </button>

        <div className={`mobile-menu ${menuOpen ? "open" : ""}`}>
          <Link to="/" onClick={closeMenu}>
            Home
          </Link>
          <Link to="/add-data" onClick={closeMenu}>
            Add Data
          </Link>
          <Link to="/edit-routine" onClick={closeMenu}>
            Edit Routine
          </Link>
          <Link to="/faculty-routine" onClick={closeMenu}>
            Faculty Routine
          </Link>
          <Link to="/about-us" onClick={closeMenu}>
            About Us
          </Link>
          <button
            className="signout-btn"
            onClick={() => {
              closeMenu();
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
