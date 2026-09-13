import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Where the FastAPI backend lives, from the dev server's point of view.
const BACKEND = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000'

// Proxy /api/* to the backend so the browser only ever talks to the Vite
// origin. That is what makes tunnels (cloudflared, ngrok, LAN IPs) work:
// a page served from https://xyz.trycloudflare.com cannot reach
// http://127.0.0.1:8000 (it's the visitor's machine, and mixed content).
const proxy = {
  '/api': {
    target: BACKEND,
    changeOrigin: true,
    ws: true,
  },
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // listen on 0.0.0.0, not just localhost
    allowedHosts: true, // accept any Host header (tunnels / LAN)
    proxy,
  },
  preview: {
    host: true,
    allowedHosts: true,
    proxy,
  },
})
