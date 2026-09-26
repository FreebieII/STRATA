// STRATA's real settings, for the Learn section's text and pictures. While the
// status is loading (or if it can't be loaded), the settings in config.yaml as
// shipped are used, and the page says which.

import { useSystemStatus } from "../api/SystemStatusContext";
import type { TradingSummary } from "../api/types";
import shipped from "./shipped.json";

// GET /system/status's view of config.yaml as shipped, written by
// scripts/dashboard_defaults.py (a test checks it matches config.yaml).
export const SHIPPED = shipped as TradingSummary;

export function useSetup(): { setup: TradingSummary; live: boolean } {
  const { status } = useSystemStatus();
  const trading = status.data?.trading;
  return trading ? { setup: trading, live: true } : { setup: SHIPPED, live: false };
}
