import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDVEE0nKCH1PDM8hkERWHPP6-PxTMIKIKs",
  authDomain: "anti-cheating-app.firebaseapp.com",
  projectId: "anti-cheating-app",
  storageBucket: "anti-cheating-app.firebasestorage.app",
  messagingSenderId: "660441863207",
  appId: "1:660441863207:web:ce966164227a74eeabea02"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Keep admin sessions only for the current browser session
setPersistence(auth, browserSessionPersistence).catch(console.error);

// Initialize Firestore with robust connection settings and offline capability
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  }),
  // Force long-polling to bypass strict school firewalls that block WebSockets
  experimentalForceLongPolling: true
});

export const storage = getStorage(app);

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
