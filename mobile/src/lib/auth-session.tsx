import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";

import { SESSION_KEY } from "./session";

type AuthSessionContextValue = {
  sessionToken: string | null;
  isLoading: boolean;
  setSessionToken: (token: string | null) => void;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(SESSION_KEY)
      .then((token) => {
        if (active) setSessionToken(token);
      })
      .catch(() => {
        if (active) setSessionToken(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthSessionContext.Provider value={{ sessionToken, isLoading, setSessionToken }}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) throw new Error("useAuthSession must be used within AuthSessionProvider.");
  return context;
}
