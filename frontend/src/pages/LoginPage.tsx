// The login page. Accounts are created on the STRATA machine itself
// (`strata operator create`); there is deliberately no way to sign up here.

import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router";

import { toApiError } from "../api/useResource";
import { useAuth } from "../auth/AuthContext";
import { IconInfo, IconWarning } from "../components/Icons";
import { Brand } from "../components/Layout";
import { Notice } from "../components/Parts";
import { Splash, Unreachable } from "./StatusScreens";

/** Only ever return to a page of this dashboard. */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/login")) return "/";
  return value;
}

export function LoginPage() {
  const { state, login, retry } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);

  if (state.phase === "checking") return <Splash />;
  if (state.phase === "unreachable") return <Unreachable error={state.error} onRetry={retry} />;
  if (state.phase === "signed-in") return <Navigate to={from} replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (failure) {
      const problem = toApiError(failure);
      setError(problem.message);
      setPassword("");
      setBusy(false);
    }
  };

  // Every current browser says; if one doesn't, don't cry wolf.
  const secure = typeof window === "undefined" || window.isSecureContext !== false;

  return (
    <div className="login">
      <main className="login__panel" id="main">
        <div className="login__brand">
          <Brand />
          <span className="mode-pill" data-mode="paper">
            PAPER
          </span>
        </div>
        <h1 className="login__title">Operator login</h1>
        <p className="login__lede">Monitoring for the STRATA trading platform.</p>

        {!secure ? (
          <Notice tone="warning" icon={<IconWarning size={18} />} title="This page isn't using HTTPS">
            Your browser won't keep the login over a plain connection. Open the dashboard with an
            address that starts with <span className="mono">https://</span>.
          </Notice>
        ) : null}
        {state.notice && !error ? (
          <Notice tone="neutral" icon={<IconInfo size={18} />} title={state.notice} />
        ) : null}

        <form className="form" onSubmit={submit} noValidate>
          <label className="field">
            <span className="field__label">Username</span>
            <input
              className="input"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={64}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </label>
          {error ? (
            <p className="form__error" id="login-error" role="alert">
              <IconWarning size={16} />
              <span>{error}</span>
            </p>
          ) : null}
          <button
            className="button button--primary button--block"
            type="submit"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="login__help">
          Accounts are made on the STRATA machine with{" "}
          <span className="mono">strata operator create</span>. After 5 wrong passwords in 15
          minutes, logins for that name pause for a while.
        </p>
      </main>
    </div>
  );
}
