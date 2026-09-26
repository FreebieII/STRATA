// The frame around every page once logged in: the trading-mode banner, the
// menu, the operator's name, the theme switch and logging out.

import { useState } from "react";
import { NavLink, Outlet } from "react-router";

import { SystemStatusProvider, useSystemStatus } from "../api/SystemStatusContext";
import { useAuth } from "../auth/AuthContext";
import { localTimeZone, shortCommit } from "../lib/format";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { NAV } from "../nav";
import { IconClose, IconLogOut, IconMenu, IconMonitor, IconMoon, IconSun, IconUser } from "./Icons";
import { ModeBanner } from "./ModeBanner";

export function Brand() {
  return (
    <span className="brand">
      <svg className="brand__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="15.5" width="18" height="3" rx="1.5" className="brand__layer brand__layer--base" />
        <rect x="3" y="10.5" width="18" height="3" rx="1.5" className="brand__layer brand__layer--mid" />
        <rect x="3" y="5.5" width="18" height="3" rx="1.5" className="brand__layer brand__layer--top" />
      </svg>
      <span className="brand__name">STRATA</span>
    </span>
  );
}

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Theme: device",
  light: "Theme: light",
  dark: "Theme: dark",
};

function ThemeButton() {
  const [theme, cycle] = useTheme();
  const Icon = theme === "light" ? IconSun : theme === "dark" ? IconMoon : IconMonitor;
  return (
    <button
      type="button"
      className="button button--ghost button--small"
      onClick={cycle}
      title="Switch between the device's theme, light and dark"
    >
      <Icon size={16} />
      <span>{THEME_LABEL[theme]}</span>
    </button>
  );
}

function Footer() {
  const { status } = useSystemStatus();
  const commit = shortCommit(status.data?.git_commit ?? null);
  return (
    <footer className="main__foot">
      <span>
        Times are in your time zone ({localTimeZone()}). Point at a time to see it in UTC.
      </span>
      {status.data ? (
        <span className="mono">
          STRATA {status.data.version}
          {commit ? ` · ${commit}` : ""}
        </span>
      ) : null}
    </footer>
  );
}

export function Layout() {
  const { state, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const username = state.phase === "signed-in" ? state.identity.username : null;

  const onLogout = async () => {
    setLogoutError(null);
    try {
      await logout();
    } catch (error) {
      setLogoutError(
        `Couldn't log out: ${error instanceof Error ? error.message : String(error)} ` +
          "Your session is still active until you log out or it expires.",
      );
    }
  };

  return (
    <SystemStatusProvider>
      <div className="app">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ModeBanner />
        <div className="app__body">
          <aside className={`sidebar${menuOpen ? " is-open" : ""}`}>
            <div className="sidebar__top">
              <NavLink to="/" className="sidebar__brand" aria-label="STRATA overview" onClick={() => setMenuOpen(false)}>
                <Brand />
              </NavLink>
              <button
                type="button"
                className="button button--ghost button--icon sidebar__menu-button"
                aria-expanded={menuOpen}
                aria-controls="sidebar-panel"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {menuOpen ? <IconClose size={20} /> : <IconMenu size={20} />}
              </button>
            </div>
            <div className="sidebar__panel" id="sidebar-panel">
              <nav className="nav" aria-label="Main">
                {NAV.map((group) => (
                  <div className="nav__group" key={group.title}>
                    <p className="nav__title">{group.title}</p>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.path}>
                          <NavLink
                            to={item.path}
                            end={item.path === "/"}
                            className={({ isActive }) => `nav__link${isActive ? " is-active" : ""}`}
                            onClick={() => setMenuOpen(false)}
                          >
                            <item.icon size={16} />
                            <span className="nav__label">{item.label}</span>
                            {item.upcoming ? <span className="nav__tag">Planned</span> : null}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
              <div className="sidebar__foot">
                <p className="who">
                  <IconUser size={16} />
                  <span className="who__name">{username ?? "operator"}</span>
                </p>
                <div className="sidebar__buttons">
                  <ThemeButton />
                  <button type="button" className="button button--ghost button--small" onClick={onLogout}>
                    <IconLogOut size={16} />
                    <span>Log out</span>
                  </button>
                </div>
                {logoutError ? (
                  <p className="sidebar__error" role="alert">
                    {logoutError}
                  </p>
                ) : null}
              </div>
            </div>
          </aside>
          <main id="main" className="main" tabIndex={-1}>
            <div className="main__content">
              <Outlet />
            </div>
            <Footer />
          </main>
        </div>
      </div>
    </SystemStatusProvider>
  );
}
