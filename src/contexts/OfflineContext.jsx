import React, { createContext, useContext, useEffect, useState } from "react";

const OfflineContext = createContext(false);

export function OfflineProvider({ children }) {
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    useEffect(() => {
        const handleOffline = () => setIsOffline(true);
        const handleOnline = () => setIsOffline(false);

        window.addEventListener("offline", handleOffline);
        window.addEventListener("online", handleOnline);

        return () => {
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("online", handleOnline);
        };
    }, []);

    return (
        <OfflineContext.Provider value={isOffline}>
        {children}
        </OfflineContext.Provider>
    );
}

export function useOffline() {
    return useContext(OfflineContext);
}
