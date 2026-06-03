import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithRedirect,
  getRedirectResult,
  signOut, 
  signInAnonymously,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signInWithCredential
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDocFromServer,
  collection,
  query,
  onSnapshot,
  addDoc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  getDoc,
  setDoc,
  increment,
  updateDoc
} from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { GoogleLogin } from '@capacitor-community/google-login';
import firebaseConfig from '../firebase-applet-config.json';

console.log('[FIREBASE] Raw config from JSON:', firebaseConfig);
const rawConfig = firebaseConfig as any;
const config = (rawConfig && rawConfig.projectId) 
  ? rawConfig 
  : (rawConfig.default || rawConfig);

console.log('[FIREBASE] Normalized config:', config);

let app: any;
try {
  app = getApps().length === 0 ? initializeApp(config) : getApp();
  console.log('[FIREBASE] App initialized:', app ? 'SUCCESS' : 'FAILURE');
} catch (e) {
  console.error('[FIREBASE] Failed to initialize Firebase App:', e);
}

let dbInstance: any = null;
if (app) {
  try {
    const dbId = config.firestoreDatabaseId && typeof config.firestoreDatabaseId === 'string' && config.firestoreDatabaseId.trim() !== '' 
      ? config.firestoreDatabaseId.trim() 
      : undefined;

    if (dbId) {
      console.log('[FIREBASE] Initializing Firestore. Database ID:', dbId);
      dbInstance = getFirestore(app, dbId);
    } else {
      console.log('[FIREBASE] Initializing Firestore. Database ID: (default)');
      dbInstance = getFirestore(app);
    }
    console.log('[FIREBASE] Firestore initialized successfully.');
  } catch (e) {
    console.error('[FIREBASE] Failed to initialize Firestore with database ID, falling back to default:', e);
    try {
      dbInstance = getFirestore(app);
      console.log('[FIREBASE] Fallback Firestore initialized successfully.');
    } catch (err2) {
      console.error('[FIREBASE] Critical: Failed to initialize Firestore entirely:', err2);
    }
  }
}

export const db = dbInstance;
console.log('[FIREBASE] db exported as:', db ? 'Firestore Instance' : 'undefined/null');

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize native Google Login (call this once at app startup)
export const initializeGoogleLogin = () => {
  if (Capacitor.isNativePlatform()) {
    console.log('[FIREBASE] Initializing native Google Login...');
    GoogleLogin.initialize({
      clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '419195353591-5ve27bkkon1shk07n8b030qshhie0scv.apps.googleusercontent.com',
      scopes: ['profile', 'email'],
      grantOfflineAccess: true,
    });
  }
};

// Start initialization automatically on module load
initializeGoogleLogin();

export async function loginWithGoogle() {
  try {
    if (Capacitor.isNativePlatform()) {
      console.log('[FIREBASE] Executing native Google Sign-In...');
      const result = await GoogleLogin.signIn();
      if (!result.authentication || !result.authentication.idToken) {
        throw new Error('No authentication token returned from native Google Sign-in');
      }
      
      console.log('[FIREBASE] Native Sign-In success, exchanging for Firebase credential...');
      const credential = GoogleAuthProvider.credential(result.authentication.idToken);
      const userCredential = await signInWithCredential(auth, credential);
      return userCredential.user;
    } else {
      console.log('[FIREBASE] Executing web popup Google Sign-In...');
      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    }
  } catch (error: any) {
    if (error.code !== 'auth/popup-closed-by-user') {
      console.error("Login failed:", error);
    }
    throw error;
  }
}

// Support sign in with redirect (useful for frames, in-app browsers, and Safari/Chrome on mobile)
export async function loginWithGoogleRedirect() {
  await signInWithRedirect(auth, googleProvider);
}

// Handle redirect result on app load
export async function handleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      console.log('Redirect signed in:', result.user);
      return result.user;
    }
  } catch (error) {
    console.error('Redirect sign-in error:', error);
  }
  return null;
}
 
export async function loginAnonymously() {
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (error) {
    console.error("Anonymous login failed:", error);
    throw error;
  }
}

export async function signUpWithEmail(email: string, pass: string, name: string) {
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  await updateProfile(result.user, { displayName: name });
  return result.user;
}

export async function loginWithEmail(email: string, pass: string) {
  const result = await signInWithEmailAndPassword(auth, email, pass);
  return result.user;
}

export async function logout() {
  await signOut(auth);
}

// Connection test as required by instructions
async function testConnection() {
  if (!db) {
    console.warn('[FIREBASE] db is not initialized, skipping testConnection');
    return;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connected successfully.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

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
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
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
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export {
  doc,
  collection,
  query,
  onSnapshot,
  addDoc,
  deleteDoc,
  serverTimestamp,
  orderBy,
  getDoc,
  setDoc,
  increment,
  updateDoc
};
