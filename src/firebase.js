// src/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// SAFETY CHECK: Throws error if .env missing
if (!firebaseConfig.apiKey) {
  throw new Error('❌ Firebase config missing! Add VITE_FIREBASE_* to .env file.');
}

// initialize app only once (prevents re-init during HMR)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// exports
export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
