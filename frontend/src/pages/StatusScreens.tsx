// Whole-page states: still checking the login, or the API can't be reached.

import type { ApiError } from "../api/client";
import { IconCritical, IconRefresh } from "../components/Icons";
import { Brand } from "../components/Layout";

export function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <Brand />
      <p className="splash__text">Checking your login…</p>
    </div>
  );
}

export function Unreachable({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="splash">
      <Brand />
      <div className="splash__problem" role="alert">
        <IconCritical size={20} />
        <div>
          <p className="splash__title">The dashboard can't reach STRATA</p>
          <p className="splash__text">{error.message}</p>
        </div>
      </div>
      <button type="button" className="button button--primary" onClick={onRetry}>
        <IconRefresh size={16} />
        <span>Try again</span>
      </button>
    </div>
  );
}
