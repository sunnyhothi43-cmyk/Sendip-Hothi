import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  signInAnonymously, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, updateProfile
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

import { getRedirectResult } from 'firebase/auth';

export async function loginWithGoogle() {
  try {
    await signInWithRedirect(auth, googleProvider);
    const result = await getRedirectResult(auth);
    if (result?.user) {
      return result.user;
    }
    return null;
  } catch (error: any) {
    if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
      console.error("Login failed:", error);
    }
    throw error;
  }
}


export async function loginAnonymously() {
  try { return (await signInAnonymously(auth)).user; }
  catch (error) { console.error("Anonymous login failed:", error); throw error; }
}

export async function signUpWithEmail(email: string, pass: string, name: string) {
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  await updateProfile(result.user, { displayName: name });
  return result.user;
}

export async function loginWithEmail(email: string, pass: string) {
  return (await signInWithEmailAndPassword(auth, email, pass)).user;
}

export async function logout() { await signOut(auth); }

async function testConnection() {
  try { await getDocFromServer(doc(db, 'test', 'connection')); console.log("Firestore connected."); }
  catch (error) { if (error instanceof Error && error.message.includes('offline')) console.error("Check Firebase config."); }
}
testConnection();

export enum OperationType {
  CREATE = 'create', UPDATE = 'update', DELETE = 'delete',
  LIST = 'list', GET = 'get', WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string; operationType: OperationType; path: string | null;
  authInfo: { userId?: string | null; email?: string | null; emailVerified?: boolean | null; isAnonymous?: boolean | null; tenantId?: string | null; providerInfo?: { providerId?: string | null; email?: string | null; }[]; };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo: auth.currentUser?.providerData?.map(p => ({ providerId: p.providerId, email: p.email })) ?? []
    },
    operationType, path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
