// Which page shows at which address, and the login gate in front of them.

import { Navigate, Route, Routes, useLocation } from "react-router";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { NAV_ITEMS } from "./nav";
import { AuditPage } from "./pages/AuditPage";
import { EventsPage } from "./pages/EventsPage";
import { LoginPage } from "./pages/LoginPage";
import { OverviewPage } from "./pages/OverviewPage";
import { RiskPage } from "./pages/RiskPage";
import { Splash, Unreachable } from "./pages/StatusScreens";
import { SystemPage } from "./pages/SystemPage";
import { NotFoundPage, UpcomingPage } from "./pages/UpcomingPage";

/** Every page except the login page needs a logged-in operator. */
function RequireLogin() {
  const { state, retry } = useAuth();
  const location = useLocation();
  if (state.phase === "checking") return <Splash />;
  if (state.phase === "unreachable") return <Unreachable error={state.error} onRetry={retry} />;
  if (state.phase === "signed-out") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Layout />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireLogin />}>
        <Route index element={<OverviewPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="risk" element={<RiskPage />} />
        {NAV_ITEMS.map((item) =>
          item.upcoming ? (
            <Route
              key={item.path}
              path={item.path.slice(1)}
              element={<UpcomingPage item={item} upcoming={item.upcoming} />}
            />
          ) : null,
        )}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
