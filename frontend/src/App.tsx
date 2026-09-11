import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { DepartmentDashboard } from "./pages/DepartmentDashboard";
import { ControllerDashboard } from "./pages/ControllerDashboard";
import { useAuthStore } from "./store/authStore";

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

  useEffect(() => {
    restore();
  }, [restore]);

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
