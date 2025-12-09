// src/components/Login.jsx
import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase"; // <- uses the auth exported from src/firebase.js
import { useNavigate, useLocation } from "react-router-dom";

/**
 * Simple, elegant login component.
 * - Email + password only.
 * - Redirects back to the original location after successful login.
 * - Minimal, accessible UI with inline styles for quick drop-in.
 */
export default function Login() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || "/";

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setLoading(true);

        if (!email || !password) {
            setError("Please enter both email and password.");
            setLoading(false);
            return;
        }

        try {
            await signInWithEmailAndPassword(auth, email.trim(), password);
            navigate(from, { replace: true });
        } catch (err) {
            console.error("Login error:", err);
            if (err?.code === "auth/wrong-password" || err?.code === "auth/user-not-found") {
                setError("Incorrect email or password.");
            } else if (err?.code === "auth/invalid-email") {
                setError("Please enter a valid email address.");
            } else {
                setError("Unable to sign in. Please try again.");
            }
            setLoading(false);
        }
    }

    return (
        <main aria-labelledby="login-heading" style={styles.page}>
        <section style={styles.card} aria-live="polite">
        <h1 id="login-heading" style={styles.title}>Sign in</h1>

        <form onSubmit={handleSubmit} style={styles.form}>
        <label htmlFor="email" style={styles.label}>Email</label>
        <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={styles.input}
        />

        <label htmlFor="password" style={styles.label}>Password</label>
        <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={styles.input}
        />

        {error && <div role="alert" style={styles.error}>{error}</div>}

        <button type="submit" disabled={loading} style={styles.button}>
        {loading ? "Signing in…" : "Sign in"}
        </button>
        </form>

        <div style={styles.footer}>
        <small>Need an account? Add a sign-up flow if your app requires registration.</small>
        </div>
        </section>
        </main>
    );
}

/* Inline styles (convert to CSS/Tailwind if you prefer) */
const styles = {
    page: {
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(180deg, #f7fafc 0%, #ffffff 100%)",
        padding: "2rem",
        fontFamily: "Inter, Roboto, system-ui, -apple-system, 'Segoe UI', Arial",
    },
    card: {
        width: "100%",
        maxWidth: 420,
        background: "white",
        borderRadius: 12,
        padding: "2rem",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
        border: "1px solid rgba(15,23,42,0.04)",
    },
    title: { margin: 0, marginBottom: "1rem", fontSize: "1.25rem", color: "#0f172a" },
    form: { display: "grid", gap: "0.625rem" },
        label: { fontSize: "0.875rem", color: "#475569" },
        input: {
            height: 42,
            padding: "0 0.75rem",
            borderRadius: 8,
            border: "1px solid #e6eef8",
            outline: "none",
            fontSize: "0.95rem",
            boxSizing: "border-box",
        },
        button: {
            marginTop: "0.5rem",
            height: 44,
            borderRadius: 10,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "1rem",
            background: "linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)",
            color: "white",
        },
        error: { color: "#b91c1c", fontSize: "0.9rem", marginTop: "0.25rem" },
        footer: { marginTop: "1rem", textAlign: "center", color: "#94a3b8" },
};
