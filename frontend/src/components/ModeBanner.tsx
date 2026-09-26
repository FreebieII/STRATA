// The strip across the top of every page that says which kind of money is at
// stake. It must be impossible to miss or misread.
//
// Today STRATA only ever trades on paper: there is no trading engine yet
// (Phase 8), and the dashboard has no way to place orders. The one thing
// that can change is the live switch in the secrets file (LIVE_TRADING=true),
// which the banner reports loudly even though live trading would still need
// the --live flag and a phrase typed at the machine.

import { useSystemStatus } from "../api/SystemStatusContext";
import { IconLock, IconUnknown, IconWarning } from "./Icons";

export function ModeBanner() {
  const { status } = useSystemStatus();
  const trading = status.data?.trading;
  const switchOn = trading?.live_trading_switch === true;

  return (
    <div
      className={`mode-banner${switchOn ? " mode-banner--switch-on" : ""}`}
      role="region"
      aria-label="Trading mode"
    >
      <div className="mode-banner__mode">
        <span className="mode-pill" data-mode="paper">
          PAPER
        </span>
        <span className="mode-banner__text">
          Simulated money only. This dashboard can't place orders.
        </span>
      </div>
      <div className="mode-banner__switch">
        {trading === undefined ? (
          <span className="switch-state switch-state--unknown">
            <IconUnknown size={16} />
            <span>Live switch: checking…</span>
          </span>
        ) : switchOn ? (
          <span className="switch-state switch-state--on">
            <IconWarning size={16} />
            <span>
              <strong>Live switch ON</strong> in the secrets file (LIVE_TRADING=true)
            </span>
          </span>
        ) : (
          <span className="switch-state switch-state--off">
            <IconLock size={16} />
            <span>Live switch off</span>
          </span>
        )}
      </div>
    </div>
  );
}
