import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut, signInAnonymously } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

interface AuthContextType {
  user: any; // Allow the user state to hold either standard Firebase User or our custom mock student user object
  isAdmin: boolean;
  loading: boolean;
  loginAsStudent: () => Promise<string>;
  logout: () => Promise<void>;
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

  const logout = async () => {
    localStorage.removeItem('cbt_student_user');
    await signOut(auth);
    setUser(null);
    setIsAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading, loginAsStudent, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
