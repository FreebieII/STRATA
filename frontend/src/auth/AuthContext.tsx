// Who is logged in, and logging in and out.
//
// The session itself lives in an HttpOnly cookie that page scripts can't read,
// so the dashboard asks the API (GET /auth/me) instead of trusting anything
// stored in the browser. Whenever the API answers "not logged in", the
// dashboard goes back to the login page.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { api, ApiError, onUnauthorised } from "../api/client";
import type { Identity } from "../api/types";
import { toApiError } from "../api/useResource";

export type AuthState =
  | { phase: "checking" }
  | { phase: "signed-out"; notice: string | null }
  | { phase: "signed-in"; identity: Identity }
  | { phase: "unreachable"; error: ApiError };

type Value = {
  state: AuthState;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
};

const AuthContext = createContext<Value | null>(null);

export const SESSION_ENDED = "Your session has ended. Log in again to continue.";
export const LOGGED_OUT = "You have logged out.";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ phase: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.me(controller.signal).then(
      (identity) => setState({ phase: "signed-in", identity }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = toApiError(error);
        setState(
          failure.status === 401
            ? { phase: "signed-out", notice: null }
            : { phase: "unreachable", error: failure },
        );
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(
    () =>
      onUnauthorised(() =>
        setState((s) => (s.phase === "signed-in" ? { phase: "signed-out", notice: SESSION_ENDED } : s)),
      ),
    [],
  );

  const login = useCallback(async (username: string, password: string) => {
    const identity = await api.login(username, password);
    setState({ phase: "signed-in", identity });
  }, []);

  // Only report "logged out" once the server has ended the session; if it
  // can't be reached, the error goes to the caller and the session remains.
  const logout = useCallback(async () => {
    await api.logout();
    setState({ phase: "signed-out", notice: LOGGED_OUT });
  }, []);

  const retry = useCallback(() => {
    setState({ phase: "checking" });
    setAttempt((n) => n + 1);
  }, []);

  return <AuthContext value={{ state, login, logout, retry }}>{children}</AuthContext>;
}

export function useAuth(): Value {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("useAuth() needs an <AuthProvider>");
  return value;
}
