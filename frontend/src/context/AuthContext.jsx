import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getCurrentUser } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [loading, setLoading] = useState(true); // true while checking stored token

  // ---- Persist token to localStorage ----
  const saveToken = useCallback((newToken) => {
    if (newToken) {
      localStorage.setItem("token", newToken);
    } else {
      localStorage.removeItem("token");
    }
    setToken(newToken);
  }, []);

  // ---- Login: store token + user ----
  const login = useCallback(
    (authResponse) => {
      saveToken(authResponse.token);
      setUser(authResponse.user);
    },
    [saveToken]
  );

  // ---- Logout: clear everything ----
  const logout = useCallback(() => {
    saveToken(null);
    setUser(null);
  }, [saveToken]);

  // ---- On mount: validate stored token by calling /auth/me ----
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    getCurrentUser(token)
      .then((data) => {
        if (data && data.user) {
          setUser(data.user);
        } else {
          // Token invalid / expired
          saveToken(null);
        }
      })
      .catch(() => {
        saveToken(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Only run once on mount — token ref is stable from localStorage

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user && !!token,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
