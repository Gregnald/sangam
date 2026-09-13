// Backend base URL.
//  - VITE_API_URL wins when set.
//  - Under the Vite dev server (`npm run dev` / electron:dev) use relative
//    URLs: vite.config.ts proxies /api/* to the backend, so the page works
//    through tunnels and LAN IPs without CORS or mixed-content trouble.
//  - Packaged Electron loads from file://, so fall back to the local backend.
const API_BASE: string = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "" : "http://127.0.0.1:8000");

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string> || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "DELETE", body: body !== undefined ? JSON.stringify(body) : undefined }),

  postForm: async <T>(path: string, form: FormData): Promise<T> => {
    const headers: Record<string, string> = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    // No Content-Type here — the browser sets multipart/form-data with the
    // right boundary itself; forcing it manually breaks the upload.
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: form });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ApiError(res.status, text);
    }
    return res.json() as Promise<T>;
  },

  waitUntilReady: async (timeoutMs = 20000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${API_BASE}/api/v1/health`);
        if (res.ok) return true;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    return false;
  },
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const usable = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (usable.length === 0) return "";
  return "?" + usable.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

export { API_BASE };
