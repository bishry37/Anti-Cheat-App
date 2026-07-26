import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut, signInAnonymously, sendPasswordResetEmail, updatePassword, fetchSignInMethodsForEmail, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

interface AuthContextType {
  user: any; // Allow the user state to hold either standard Firebase User or our custom mock student user object
  isAdmin: boolean;
  loading: boolean;
  loginAsStudent: () => Promise<string>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  reauthenticate: (password: string) => Promise<void>;
  checkEmailExists: (email: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        if (!currentUser.isAnonymous) {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
        }
        setLoading(false);
      } else {
        // Fallback check: if there is a local student custom session, recover it
        const localStudent = localStorage.getItem('cbt_student_user');
        if (localStudent) {
          try {
            const parsed = JSON.parse(localStudent);
            setUser(parsed);
            setIsAdmin(false);
          } catch {
            setUser(null);
            setIsAdmin(false);
          }
        } else {
          setUser(null);
          setIsAdmin(false);
        }
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const loginAsStudent = async (): Promise<string> => {
    try {
      const credential = await signInAnonymously(auth);
      return credential.user.uid;
    } catch (err: any) {
      console.warn("Firebase Anonymous Sign-In failed or was restricted. Falling back to custom client-side student session:", err);
      
      // Let's check if there's already a persistent user
      const existingLocal = localStorage.getItem('cbt_student_user');
      if (existingLocal) {
        try {
          const parsed = JSON.parse(existingLocal);
          setUser(parsed);
          setIsAdmin(false);
          return parsed.uid;
        } catch {
          // ignore error
        }
      }

      // Generate a persistent, random, collision-resistant UID for the student session
      const uid = 'stud_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
      const mockUser = {
        uid,
        isAnonymous: true,
        displayName: 'Siswa'
      };
      localStorage.setItem('cbt_student_user', JSON.stringify(mockUser));
      setUser(mockUser);
      setIsAdmin(false);
      return uid;
    }
  };

  const resetPassword = async (email: string) => {
    return sendPasswordResetEmail(auth, email);
  };

  const changePassword = async (newPassword: string) => {
    if (auth.currentUser) {
      return updatePassword(auth.currentUser, newPassword);
    }
    throw new Error('No user logged in');
  };

  const reauthenticate = async (password: string) => {
    console.log("Attempting reauthentication for:", auth.currentUser?.email);
    if (auth.currentUser && auth.currentUser.email) {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
      try {
        const result = await reauthenticateWithCredential(auth.currentUser, credential);
        console.log("Reauthentication successful", result);
        return result;
      } catch (err: any) {
        console.error("Reauthentication failed", err);
        throw err;
      }
    }
    console.error("Reauthentication failed: No user or email");
    throw new Error('Cannot reauthenticate');
  };

  const checkEmailExists = async (email: string) => {
    try {
      const methods = await fetchSignInMethodsForEmail(auth, email);
      return methods.length > 0;
    } catch (err) {
      console.warn("Check email exists fallback", err);
      return false; // Safely return false if disabled/fails
    }
  };

  const logout = async () => {
    localStorage.removeItem('cbt_student_user');
    sessionStorage.removeItem('just_logged_in_student');
    sessionStorage.removeItem('just_logged_in_admin');
    await signOut(auth);
    setUser(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, loginAsStudent, logout, resetPassword, changePassword, reauthenticate, checkEmailExists }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
