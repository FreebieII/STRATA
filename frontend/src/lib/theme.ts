// Light, dark, or follow the device. The choice is a convenience for this
// browser only (kept in localStorage, which may be unavailable).

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "strata.theme";

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Storage blocked: the choice lasts until the page is reloaded.
  }
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };

export function useTheme(): [ThemeChoice, () => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);
  useEffect(() => applyThemeChoice(choice), [choice]);
  const cycle = useCallback(() => setChoice((c) => NEXT[c]), []);
  return [choice, cycle];
}
