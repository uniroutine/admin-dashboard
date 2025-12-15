// src/main.jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext'; // provide auth context to the whole app

// Add OfflineProvider (assumes you created src/context/OfflineContext.jsx)
import { OfflineProvider } from './contexts/OfflineContext';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <OfflineProvider>
        <App />
      </OfflineProvider>
      </AuthProvider>
  </React.StrictMode>
);
