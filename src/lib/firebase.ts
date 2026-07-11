// Init Firebase solo si hay config en env. Sin config → export null, la app no crashea.
// ponytail: config por VITE_FB_* env; rellenar en .env cuando exista el proyecto Firebase.
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const cfg = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FB_APP_ID,
};

export const isConfigured = Boolean(cfg.apiKey && cfg.projectId);

let app: FirebaseApp | null = null;
export const db: Firestore | null = isConfigured ? getFirestore((app = initializeApp(cfg))) : null;
export const storage: FirebaseStorage | null = app ? getStorage(app) : null;
