import { create } from "zustand";
import { api, setAuthToken } from "../lib/api";
import type { LoginResponse, Role } from "../types/api";

interface AuthState {
  token: string | null;
  username: string | null;
  role: Role | null;
  displayName: string | null;
  error: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  restore: () => void;
}

const STORAGE_KEY = "sangam.auth";

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  username: null,
  role: null,
  displayName: null,
  error: null,
  isLoading: false,

  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post<LoginResponse>("/api/v1/auth/login", { username, password });
      setAuthToken(res.token);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(res));
      set({ token: res.token, username: res.username, role: res.role, displayName: res.displayName, isLoading: false });
      return true;
    } catch {
      set({ isLoading: false, error: "Invalid username or password" });
      return false;
    }
  },

  logout: () => {
    setAuthToken(null);
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, username: null, role: null, displayName: null });
  },

  restore: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const res: LoginResponse = JSON.parse(raw);
      setAuthToken(res.token);
      set({ token: res.token, username: res.username, role: res.role, displayName: res.displayName });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  },
}));
