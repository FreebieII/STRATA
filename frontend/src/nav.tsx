// The dashboard's pages, in menu order. Pages whose data doesn't exist yet say
// so plainly and name the phase that brings them (see BUILD_PLAN.md).

import type { ComponentType } from "react";

import {
  IconAgents,
  IconAudit,
  IconBacktests,
  IconBook,
  IconEvents,
  IconGlossary,
  IconOrders,
  IconOverview,
  IconPerformance,
  IconPositions,
  IconRisk,
  IconServer,
} from "./components/Icons";

export type Upcoming = {
  // What the page will show.
  shows: string[];
  // When it arrives, in words: "Phase 8 (paper trading)".
  arrives: string;
  // What exists today instead.
  today: string;
};

export type NavItem = {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  upcoming?: Upcoming;
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    title: "Monitor",
    items: [
      { path: "/", label: "Overview", icon: IconOverview },
      { path: "/system", label: "System", icon: IconServer },
      { path: "/events", label: "Events", icon: IconEvents },
      { path: "/audit", label: "Audit log", icon: IconAudit },
    ],
  },
  {
    title: "Trading",
    items: [
      { path: "/risk", label: "Risk limits", icon: IconRisk },
      {
        path: "/positions",
        label: "Positions",
        icon: IconPositions,
        upcoming: {
          shows: [
            "Every open position: quantity, entry price, current value, profit or loss",
            "Its stop-loss and take-profit prices, and how far the price is from each",
            "Exposure per instrument and in total, against the risk limits",
          ],
          arrives: "Phase 8 (paper trading), on screen in Phase 9",
          today: "Nothing trades yet, so there are no positions.",
        },
      },
      {
        path: "/orders",
        label: "Orders",
        icon: IconOrders,
        upcoming: {
          shows: [
            "Every order with its client order ID, status and fills (including partial fills)",
            "Orders the risk engine rejected, and the reason for each",
            "What reconciliation with the broker found on each start-up",
          ],
          arrives: "Phase 8 (paper trading), on screen in Phase 9",
          today: "No order can be placed yet, from the dashboard or anywhere else.",
        },
      },
      {
        path: "/performance",
        label: "Performance",
        icon: IconPerformance,
        upcoming: {
          shows: [
            "Equity over time and drawdown from the peak",
            "Daily and total profit or loss against the loss limits",
            "The same figures for buy-and-hold, for comparison",
          ],
          arrives: "Phase 8 (paper trading), on screen in Phase 9",
          today: "There is no trading history yet, so there is nothing to measure.",
        },
      },
    ],
  },
  {
    title: "Research",
    items: [
      {
        path: "/backtests",
        label: "Backtests",
        icon: IconBacktests,
        upcoming: {
          shows: [
            "Each backtest run: data, dates, strategy version, parameters and code version",
            "In-sample and out-of-sample results side by side, never mixed",
            "Return, drawdown, win rate, trades, losing streaks and buy-and-hold",
          ],
          arrives: "Phase 4 (backtesting)",
          today: "No backtest has been run. Past results would not predict future ones anyway.",
        },
      },
      {
        path: "/agents",
        label: "Agents",
        icon: IconAgents,
        upcoming: {
          shows: [
            "Each analysis agent's latest view, its confidence and its reasoning",
            "The supervisor's proposals, and the critic's objections",
            "Which proposals the risk engine let through, and which it refused",
          ],
          arrives: "Phase 5 (agents) and Phase 6 (supervisor)",
          today: "No agents run yet. They will never place orders themselves.",
        },
      },
    ],
  },
  {
    title: "Learn",
    items: [
      { path: "/learn", label: "How trading works", icon: IconBook },
      { path: "/learn/glossary", label: "Glossary", icon: IconGlossary },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((group) => group.items);

/** Is `item` the page at `pathname`? The page it matches most closely wins, so
 * /learn/glossary is the glossary and /learn/markets is "How trading works". */
export function isCurrent(item: NavItem, pathname: string): boolean {
  const within = (path: string) =>
    path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
  if (!within(item.path)) return false;
  return !NAV_ITEMS.some((other) => other.path.length > item.path.length && within(other.path));
}
