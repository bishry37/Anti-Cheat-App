import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { getFirestore, initializeFirestore, Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDVEE0nKCH1PDM8hkERWHPP6-PxTMIKIKs",
  authDomain: "anti-cheating-app.firebaseapp.com",
  projectId: "anti-cheating-app",
  storageBucket: "anti-cheating-app.firebasestorage.app",
  messagingSenderId: "660441863207",
  appId: "1:660441863207:web:ce966164227a74eeabea02",
  firestoreDatabaseId: "(default)"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Enforce tab-level session persistence so logging in on one tab does NOT log in remaining tabs
setPersistence(auth, browserSessionPersistence).catch((err) => {
  console.warn("Unable to set browserSessionPersistence:", err);
});

let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    { experimentalForceLongPolling: true },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = dbInstance;
export const storage = getStorage(app);

export async function withFirestoreTimeout<T>(
  promise: Promise<T>,
  ms = 12000,
  errorMessage = 'Koneksi ke server melebihi batas waktu. Periksa koneksi internet atau kuota Firebase Anda.'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Error handling helper
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
