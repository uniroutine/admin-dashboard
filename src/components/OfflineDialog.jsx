import React from "react";
import { useOffline } from "../contexts/OfflineContext";
import "./offline.css";

function OfflineDialog() {
    const isOffline = useOffline();

    if (!isOffline) return null;

    return (
        <div className="offline-overlay">
        <div className="offline-dialog">
        <div className="offline-icon">🚫</div>
        <h2>You’re offline</h2>
        <p>
        Please check your network connection
        </p>
        </div>
        </div>
    );
}

export default OfflineDialog;
