// Electron main process. Responsibilities:
//  1. Best-effort bring-up of the backend (docker compose db + uvicorn) so a
//     double-click launch "just works" when the dev has already run
//     `pip install -r backend/requirements.txt` once.
//  2. Open the app window pointed at the Vite dev server (electron:dev) or
//     the built dist/ (packaged app).
// If the backend is already running (started manually, e.g. via
// `make serve`), step 1 is a harmless no-op — see waitForHealth() below.

const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");
const API_URL = "http://127.0.0.1:8000/api/v1/health";

let backendProcess = null;
let mainWindow = null;

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(API_URL, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForHealth(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function venvPython() {
  const win = path.join(BACKEND_DIR, ".venv", "Scripts", "python.exe");
  const posix = path.join(BACKEND_DIR, ".venv", "bin", "python");
  const fs = require("node:fs");
  if (fs.existsSync(win)) return win;
  if (fs.existsSync(posix)) return posix;
  return process.platform === "win32" ? "python" : "python3"; // fall back to PATH
}

async function ensureBackend() {
  if (await checkHealth()) {
    console.log("[sangam] backend already running");
    return;
  }

  console.log("[sangam] backend not reachable, attempting docker compose up -d db ...");
  try {
    await new Promise((resolve) => {
      const dc = spawn("docker", ["compose", "up", "-d", "db"], { cwd: REPO_ROOT, shell: true });
      dc.on("close", resolve);
      dc.on("error", resolve);
    });
  } catch (err) {
    console.warn("[sangam] docker compose failed (is Docker running?):", err);
  }

  console.log("[sangam] starting backend API (python main.py) ...");
  backendProcess = spawn(venvPython(), ["main.py"], {
    cwd: BACKEND_DIR,
    shell: true,
  });
  backendProcess.stdout?.on("data", (d) => console.log(`[backend] ${d}`.trimEnd()));
  backendProcess.stderr?.on("data", (d) => console.log(`[backend] ${d}`.trimEnd()));
  backendProcess.on("error", (err) => console.error("[sangam] failed to spawn backend:", err));

  const ok = await waitForHealth(30000);
  console.log(ok ? "[sangam] backend is up" : "[sangam] backend did not become healthy in time (see README)");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "SANGAM — Block Planning",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(async () => {
  createWindow();
  ensureBackend(); // fire-and-forget; renderer handles a not-yet-ready API gracefully
});

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (backendProcess) backendProcess.kill();
});
