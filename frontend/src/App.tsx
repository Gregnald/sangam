import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { DepartmentDashboard } from "./pages/DepartmentDashboard";
import { ControllerDashboard } from "./pages/ControllerDashboard";
import { useAuthStore } from "./store/authStore";
import { useThemeStore } from "./store/themeStore";
import { connectLive, disconnectLive } from "./lib/live";

function Home() {
  const role = useAuthStore((s) => s.role);
  if (!role) return <Navigate to="/login" replace />;
  return role === "CONTROLLER" ? <ControllerDashboard /> : <DepartmentDashboard />;
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const role = useAuthStore((s) => s.role);
  if (!role) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  const restore = useAuthStore((s) => s.restore);
  const token = useAuthStore((s) => s.token);
  const initTheme = useThemeStore((s) => s.init);

  useEffect(() => {
    initTheme();
    restore();
  }, [initTheme, restore]);

  // Live updates for the whole session: anything that changes on the
  // server shows up here without a refresh.
  useEffect(() => {
    if (!token) return;
    connectLive(token);
    return () => disconnectLive();
  }, [token]);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Home />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
