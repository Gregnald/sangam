import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const isLoading = useAuthStore((s) => s.isLoading);
  const role = useAuthStore((s) => s.role);
  const navigate = useNavigate();

  // A hard page load lands here first (role is still null the instant the
  // app mounts, before the auth store's restore() reads localStorage) — once
  // it resolves to an already-logged-in session, leave this route instead of
  // stranding the user on the login form forever.
  if (role) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await login(username, password);
    if (ok) navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ops-bg">
      <form onSubmit={handleSubmit} className="w-full max-w-sm border border-ops-border bg-ops-panel p-8">
        <h1 className="text-lg font-semibold text-ops-text tracking-wide">SANGAM</h1>
        <p className="text-xs text-ops-muted mt-1 mb-6">Block Planning &amp; Coordination</p>

        <label className="block text-xs font-medium text-ops-muted mb-1">Username</label>
        <input
          className="w-full mb-4 px-3 py-2 bg-black/20 border border-ops-border text-ops-text text-sm focus:outline-none focus:border-ops-accent"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <label className="block text-xs font-medium text-ops-muted mb-1">Password</label>
        <input
          type="password"
          className="w-full mb-6 px-3 py-2 bg-black/20 border border-ops-border text-ops-text text-sm focus:outline-none focus:border-ops-accent"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-xs text-red-400 mb-4">{error}</p>}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 bg-ops-accent hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {isLoading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
