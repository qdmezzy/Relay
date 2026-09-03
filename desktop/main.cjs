const { app, BrowserWindow, Menu, Tray, clipboard, globalShortcut, ipcMain, nativeImage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");

const projectRoot = path.resolve(__dirname, "..");
const allowedPaths = new Set([
  "/api/status",
  "/api/config",
  "/api/backend/recheck",
  "/api/control",
  "/translate",
]);

let mainWindow;
let tray;
let serverChild;
let helperChild;
let serverLog;
let quitting = false;
let configPath;
let servicePort = 8765;

app.setName("Relay");
const userDataPath = path.join(app.getPath("appData"), "Relay");
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath("userData", userDataPath);
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();

function brandIcon(size = 32) {
  return nativeImage.createFromPath(path.join(__dirname, "assets", "icon.ico")).resize({ width: size, height: size });
}

function loadServiceConfig() {
  const fallback = { port: 8765 };
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return fallback;
  }
}

function prepareConfig() {
  if (!app.isPackaged) {
    configPath = path.join(projectRoot, "config.json");
    servicePort = loadServiceConfig().port || 8765;
    return;
  }

  const dataDir = app.getPath("userData");
  configPath = path.join(dataDir, "config.json");
  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(path.join(process.resourcesPath, "runtime", "config.json"), configPath);
  }
  servicePort = loadServiceConfig().port || 8765;
}

function runtimeEnvironment() {
  return {
    ...process.env,
    TYPE_TRANSLATE_CONFIG: configPath,
  };
}

function startRuntime() {
  const runtime = app.isPackaged
    ? path.join(process.resourcesPath, "runtime")
    : projectRoot;
  const logPath = path.join(app.getPath("userData"), "server.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  serverLog = fs.openSync(logPath, "a");

  if (app.isPackaged) {
    serverChild = spawn(path.join(runtime, "Relay Server.exe"), [], {
      cwd: runtime,
      env: runtimeEnvironment(),
      windowsHide: true,
      stdio: ["ignore", serverLog, serverLog],
    });
    helperChild = spawn(path.join(runtime, "Relay Helper.exe"), [], {
      cwd: runtime,
      env: runtimeEnvironment(),
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }

  const nodePath = process.env.npm_node_execpath || "node";
  serverChild = spawn(nodePath, [path.join(projectRoot, "src", "server.js")], {
    cwd: projectRoot,
    env: runtimeEnvironment(),
    windowsHide: true,
    stdio: ["ignore", serverLog, serverLog],
  });

  const ahkPaths = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "AutoHotkey", "v2", "AutoHotkey64.exe"),
    path.join(process.env.ProgramFiles || "", "AutoHotkey", "v2", "AutoHotkey64.exe"),
  ];
  const ahk = ahkPaths.find((candidate) => candidate && fs.existsSync(candidate));
  if (ahk) {
    helperChild = spawn(ahk, [path.join(projectRoot, "ahk", "relay.ahk")], {
      cwd: projectRoot,
      env: runtimeEnvironment(),
      windowsHide: true,
      stdio: "ignore",
    });
  }
}

function releaseModel(done) {
  let host = "http://127.0.0.1:11434";
  let model = "";
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if ((config.provider || "ollama") !== "ollama") return done();
    host = config.providers?.ollama?.host || host;
    model = config.providers?.ollama?.model || "";
  } catch {
    return done();
  }
  if (!model) return done();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done();
  };

  try {
    const url = new URL(host.replace(/\/+$/, "") + "/api/chat");
    const body = JSON.stringify({ model, messages: [], keep_alive: 0 });
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        res.on("end", finish);
      }
    );
    request.on("error", finish);
    request.setTimeout(700, () => {
      request.destroy();
      finish();
    });
    request.end(body);
  } catch {
    finish();
  }
}

function stopRuntime() {
  for (const child of [helperChild, serverChild]) {
    if (child && child.exitCode === null) child.kill();
  }
  if (serverLog) {
    try {
      fs.closeSync(serverLog);
    } catch {}
    serverLog = null;
  }
}

function setupUpdates() {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return;
  }

  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  autoUpdater.autoDownload = !portable;
  autoUpdater.autoInstallOnAppQuit = !portable;

  const tell = (state, detail) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update", { state, ...detail });
    }
  };

  autoUpdater.on("update-available", (info) => tell("available", { version: info.version, portable }));
  autoUpdater.on("update-not-available", () => tell("current", {}));
  autoUpdater.on("download-progress", (p) => tell("downloading", { percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => tell("ready", { version: info.version }));
  autoUpdater.on("error", (error) => tell("error", { message: String(error?.message || error) }));

  ipcMain.handle("app:install-update", () => {
    if (portable) return shell.openExternal("https://github.com/qdmezzy/relay/releases/latest");
    quitting = true;
    autoUpdater.quitAndInstall();
  });
  ipcMain.handle("app:check-updates", () => autoUpdater.checkForUpdates().catch(() => null));

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 24 * 60 * 60 * 1000);
}

function showWindow(page) {
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  if (page) mainWindow.webContents.send("navigate", page);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: "#f6f6f4",
    icon: brandIcon(256),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function createTray() {
  tray = new Tray(brandIcon(24));
  tray.setToolTip("Relay");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Relay", click: () => showWindow("home") },
    { label: "Voice & tone", click: () => showWindow("voice") },
    { label: "Settings", click: () => showWindow("settings") },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => showWindow());
}

async function serviceRequest(request) {
  if (!request || !allowedPaths.has(request.path)) {
    throw new Error("That app request is not allowed.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeout || 50000);
  try {
    const response = await fetch("http://127.0.0.1:" + servicePort + request.path, {
      method: request.method || "GET",
      headers: request.body ? { "Content-Type": "application/json; charset=utf-8" } : undefined,
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") && text ? JSON.parse(text) : text;
    if (!response.ok) {
      throw new Error(data?.error || text || "The request failed.");
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function registerIpc() {
  ipcMain.handle("service:request", (_, request) => serviceRequest(request));
  ipcMain.handle("app:meta", () => ({ version: app.getVersion(), packaged: app.isPackaged }));
  ipcMain.handle("app:open-data", () => shell.showItemInFolder(configPath));
  ipcMain.handle("app:open-external", (_, url) => {
    if (url === "https://ollama.com/download") return shell.openExternal(url);
    throw new Error("That link is not allowed.");
  });
  ipcMain.handle("clipboard:write", (_, text) => clipboard.writeText(String(text || "")));
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on("window:hide", () => mainWindow?.hide());
}

app.on("second-instance", () => showWindow());
app.on("window-all-closed", () => {});
let modelReleased = false;
app.on("before-quit", (event) => {
  quitting = true;
  if (!modelReleased) {
    modelReleased = true;
    event.preventDefault();
    releaseModel(() => app.quit());
    return;
  }
  globalShortcut.unregisterAll();
  stopRuntime();
});

app.whenReady().then(() => {
  app.setAppUserModelId("com.relay.desktop");
  Menu.setApplicationMenu(null);
  prepareConfig();
  registerIpc();
  startRuntime();
  createWindow();
  createTray();
  globalShortcut.register("Control+Alt+T", () => showWindow());
  setupUpdates();
});
