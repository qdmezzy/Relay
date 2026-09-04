const { app, BrowserWindow, Menu, Tray, clipboard, globalShortcut, ipcMain, nativeImage, nativeTheme, safeStorage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const http = require("node:http");

const projectRoot = path.resolve(__dirname, "..");
const allowedPaths = new Set([
  "/api/status",
  "/api/config",
  "/api/backend/recheck",
  "/api/backend/pull",
  "/api/control",
  "/api/history",
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
let savedAnthropicKey = "";
let secretPath;
let openShortcut = "Control+Alt+T";
let trayTimer;
let traySnapshot = null;
const activeRequests = new Map();

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

function saveServiceConfig(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temp = configPath + ".desktop.tmp";
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", "utf8");
  fs.renameSync(temp, configPath);
  return config;
}

function updateBehavior(patch) {
  const config = loadServiceConfig();
  config.behavior = { ...(config.behavior || {}), ...patch };
  return saveServiceConfig(config).behavior;
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

// the sync pair is the documented one and gives back a string. the async
// variants got preferred here and handed back a plain {} instead, which then
// went to the sdk as the api key - so every request came back "credentials
// rejected" while the key sat on disk perfectly fine.
async function encryptSecret(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is not available yet.");
  const out = safeStorage.encryptString(String(value));
  if (!Buffer.isBuffer(out)) throw new Error("Secure storage did not return an encrypted key.");
  return out;
}

async function decryptSecret(value) {
  const out = safeStorage.decryptString(value);
  return typeof out === "string" ? out : "";
}

async function prepareSecrets() {
  secretPath = path.join(app.getPath("userData"), "anthropic-key.bin");
  try {
    if (fs.existsSync(secretPath) && safeStorage.isEncryptionAvailable()) {
      savedAnthropicKey = await decryptSecret(fs.readFileSync(secretPath));
    }
  } catch {
    savedAnthropicKey = "";
  }

  // never let anything but a real key string past here. passing an object to
  // the sdk fails as an auth error, which reads like a bad key and sends you
  // hunting in the wrong place.
  if (typeof savedAnthropicKey !== "string") savedAnthropicKey = "";
  savedAnthropicKey = savedAnthropicKey.trim();
  if (savedAnthropicKey && !savedAnthropicKey.startsWith("sk-")) {
    console.error("[relay] stored key does not look like an API key - ignoring it");
    savedAnthropicKey = "";
  }

  const config = loadServiceConfig();
  const legacyKey = config.providers?.anthropic?.apiKey;
  if (typeof legacyKey === "string" && legacyKey.trim()) {
    if (!savedAnthropicKey) {
      const encrypted = await encryptSecret(legacyKey.trim());
      fs.writeFileSync(secretPath, encrypted);
      savedAnthropicKey = legacyKey.trim();
    }
    delete config.providers.anthropic.apiKey;
    saveServiceConfig(config);
  }
}

async function storeAnthropicKey(value) {
  const key = String(value || "").trim();
  if (!key) throw new Error("Paste an API key first.");
  const encrypted = await encryptSecret(key);
  fs.writeFileSync(secretPath, encrypted);
  savedAnthropicKey = key;
  return secretStatus();
}

function removeAnthropicKey() {
  savedAnthropicKey = "";
  if (secretPath && fs.existsSync(secretPath)) fs.rmSync(secretPath);
  return secretStatus();
}

function secretStatus() {
  return {
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY || savedAnthropicKey),
    fromEnvironment: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

function runtimeEnvironment() {
  const environment = {
    ...process.env,
    RELAY_CONFIG: configPath,
    RELAY_PORT: String(servicePort),
  };
  if (!environment.ANTHROPIC_API_KEY && savedAnthropicKey) {
    environment.ANTHROPIC_API_KEY = savedAnthropicKey;
  }
  return environment;
}

function runtimeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "runtime")
    : projectRoot;
}

function keepAlive(kind, child) {
  child.once("exit", () => {
    if (kind === "server" && serverChild === child) serverChild = null;
    if (kind === "helper" && helperChild === child) helperChild = null;
    if (quitting) return;
    setTimeout(() => kind === "server" ? startServerProcess() : startHelperProcess(), 900);
  });
}

function startServerProcess() {
  if (serverChild && serverChild.exitCode === null) return;
  const runtime = runtimeRoot();
  if (app.isPackaged) {
    serverChild = spawn(path.join(runtime, "Relay Server.exe"), [], {
      cwd: runtime,
      env: runtimeEnvironment(),
      windowsHide: true,
      stdio: ["ignore", serverLog, serverLog],
    });
  } else {
    const nodePath = process.env.npm_node_execpath || "node";
    serverChild = spawn(nodePath, [path.join(projectRoot, "src", "server.js")], {
      cwd: projectRoot,
      env: runtimeEnvironment(),
      windowsHide: true,
      stdio: ["ignore", serverLog, serverLog],
    });
  }
  keepAlive("server", serverChild);
}

function startHelperProcess() {
  if (helperChild && helperChild.exitCode === null) return;
  const runtime = runtimeRoot();
  if (app.isPackaged) {
    helperChild = spawn(path.join(runtime, "Relay Helper.exe"), [], {
      cwd: runtime,
      env: runtimeEnvironment(),
      windowsHide: true,
      stdio: "ignore",
    });
  } else {
    const ahkPaths = [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "AutoHotkey", "v2", "AutoHotkey64.exe"),
      path.join(process.env.ProgramFiles || "", "AutoHotkey", "v2", "AutoHotkey64.exe"),
    ];
    const ahk = ahkPaths.find((candidate) => candidate && fs.existsSync(candidate));
    if (!ahk) return;
    helperChild = spawn(ahk, [path.join(projectRoot, "ahk", "relay.ahk")], {
      cwd: projectRoot,
      env: runtimeEnvironment(),
      windowsHide: true,
      stdio: "ignore",
    });
  }
  keepAlive("helper", helperChild);
}

function restartServer() {
  if (serverChild && serverChild.exitCode === null) serverChild.kill();
  else startServerProcess();
}

function startRuntime() {
  const logPath = path.join(app.getPath("userData"), "server.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  serverLog = fs.openSync(logPath, "a");
  startServerProcess();
  startHelperProcess();
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

  ipcMain.handle("app:install-update", (event) => {
    requireTrusted(event);
    if (portable) return shell.openExternal("https://github.com/qdmezzy/relay/releases/latest");
    quitting = true;
    autoUpdater.quitAndInstall();
  });
  ipcMain.handle("app:check-updates", (event) => {
    requireTrusted(event);
    return autoUpdater.checkForUpdates().catch(() => null);
  });

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

function languageName(language) {
  return { ko: "Korean", ja: "Japanese", fr: "French" }[language] || "Japanese";
}

function processLabel(processName) {
  return String(processName || "").replace(/\.exe$/i, "") || "None";
}

function alwaysBlockedApp(processName) {
  return new Set([
    "windowsterminal.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe",
    "mintty.exe", "bash.exe", "wsl.exe", "ssh.exe", "1password.exe", "bitwarden.exe",
    "keepass.exe", "keepassxc.exe", "credentialuibroker.exe",
  ]).has(String(processName || "").toLowerCase());
}

function allowedApps() {
  const apps = loadServiceConfig().behavior?.allowedApps;
  return Array.isArray(apps) ? apps.filter(Boolean) : [];
}

function allowApp(processName) {
  if (!processName) return allowedApps();
  const current = allowedApps();
  if (!current.some((item) => item.toLowerCase() === processName.toLowerCase())) current.push(processName);
  updateBehavior({ allowedApps: current.slice(0, 30) });
  return current;
}

async function queueControl(action, value = "") {
  return serviceRequest({ path: "/api/control", method: "POST", body: { action, value }, timeout: 3000 });
}

async function setTrayLanguage(language) {
  updateBehavior({ lastLanguage: language });
  const runtime = traySnapshot?.runtime || {};
  if (runtime.autoLang && runtime.autoProc) {
    const apps = allowApp(runtime.autoProc);
    await queueControl("safety-apps", apps.join("|"));
    await queueControl("auto-target", language + "|" + runtime.autoProc);
  }
  setTimeout(refreshTrayMenu, 450);
}

async function toggleTrayAuto() {
  const runtime = traySnapshot?.runtime || {};
  if (runtime.autoLang) {
    await queueControl("auto-off");
  } else {
    const target = runtime.autoProc || runtime.targetProc;
    if (!target) {
      showWindow("home");
      return;
    }
    if (alwaysBlockedApp(target)) {
      showWindow("home");
      return;
    }
    const behavior = loadServiceConfig().behavior || {};
    const language = behavior.lastLanguage || "ja";
    const apps = allowApp(target);
    await queueControl("safety-apps", apps.join("|"));
    await queueControl("auto-target", language + "|" + target);
  }
  setTimeout(refreshTrayMenu, 450);
}

function trayTemplate() {
  const runtime = traySnapshot?.runtime || {};
  const behavior = loadServiceConfig().behavior || {};
  const language = runtime.autoLang || behavior.lastLanguage || "ja";
  const target = runtime.autoProc || runtime.targetProc || "";
  const template = [
    {
      label: runtime.autoLang ? "Auto Translate · " + languageName(runtime.autoLang) : "Auto Translate",
      type: "checkbox",
      checked: Boolean(runtime.autoLang),
      enabled: Boolean(traySnapshot),
      click: () => toggleTrayAuto().catch(() => showWindow("home")),
    },
    {
      label: "Language",
      enabled: Boolean(traySnapshot),
      submenu: [
        ["ko", "Korean"],
        ["ja", "Japanese"],
        ["fr", "French"],
      ].map(([value, label]) => ({
        label,
        type: "radio",
        checked: language === value,
        click: () => setTrayLanguage(value).catch(() => showWindow("home")),
      })),
    },
    { label: "Target · " + processLabel(target), enabled: false },
  ];
  if (runtime.safetyPaused) template.push({ label: "Paused · " + (runtime.safetyReason || "Sensitive field"), enabled: false });
  template.push(
    { type: "separator" },
    { label: "Translate selected text", accelerator: "Ctrl+Alt+H", click: () => queueControl("read-selection").catch(() => {}) },
    { label: "Open Relay", click: () => showWindow("home") },
    { label: "Settings", click: () => showWindow("settings") },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } }
  );
  return template;
}

async function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  try {
    traySnapshot = await serviceRequest({ path: "/api/status", method: "GET", timeout: 1800 });
  } catch {
    traySnapshot = null;
  }
  tray.setToolTip(traySnapshot?.runtime?.safetyPaused ? "Relay · Paused" : "Relay");
}

async function syncHelperBehavior() {
  const behavior = loadServiceConfig().behavior || {};
  await queueControl("safety-apps", allowedApps().join("|"));
  await queueControl("send-mode", behavior.sendMode || "instant");
  await queueControl("selection-popup", String(behavior.selectionPopupEnabled !== false));
}

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: dark ? "#171716" : "#f6f6f4",
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
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
}

function createTray() {
  tray = new Tray(brandIcon(24));
  tray.setToolTip("Relay");
  tray.on("click", () => showWindow());
  tray.on("right-click", () => tray.popUpContextMenu(Menu.buildFromTemplate(trayTemplate())));
  refreshTrayMenu();
  trayTimer = setInterval(refreshTrayMenu, 1800);
}

async function serviceRequest(request) {
  if (!request || !allowedPaths.has(request.path)) {
    throw new Error("That app request is not allowed.");
  }
  const controller = new AbortController();
  const requestId = String(request.id || "");
  if (requestId) activeRequests.set(requestId, controller);
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
    if (requestId) activeRequests.delete(requestId);
  }
}

function trusted(event) {
  try {
    return new URL(event.senderFrame.url).protocol === "file:";
  } catch {
    return false;
  }
}

function requireTrusted(event) {
  if (!trusted(event)) throw new Error("That app request is not allowed.");
}

function applyTheme(theme) {
  nativeTheme.themeSource = ["light", "dark"].includes(theme) ? theme : "system";
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#171716" : "#f6f6f4");
  }
}

function preferences() {
  const behavior = loadServiceConfig().behavior || {};
  return {
    theme: behavior.theme || "system",
    dark: nativeTheme.shouldUseDarkColors,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    startupSupported: app.isPackaged,
    openShortcut,
  };
}

function registerOpenShortcut(accelerator, persist = true) {
  const next = String(accelerator || "").trim();
  if (!next) return { ok: false, message: "Choose a shortcut." };
  const previous = openShortcut;
  globalShortcut.unregister(previous);
  const ok = globalShortcut.register(next, () => showWindow());
  if (!ok) {
    globalShortcut.register(previous, () => showWindow());
    return { ok: false, shortcut: previous, message: "That shortcut is already being used by another app." };
  }
  openShortcut = next;
  if (persist) updateBehavior({ openShortcut });
  return { ok: true, shortcut: openShortcut };
}

function registerIpc() {
  ipcMain.handle("service:request", (event, request) => {
    requireTrusted(event);
    return serviceRequest(request);
  });
  ipcMain.handle("service:cancel", (event, requestId) => {
    requireTrusted(event);
    activeRequests.get(String(requestId || ""))?.abort();
  });
  ipcMain.handle("service:restart", (event) => {
    requireTrusted(event);
    restartServer();
  });
  ipcMain.handle("app:meta", (event) => {
    requireTrusted(event);
    return { version: app.getVersion(), packaged: app.isPackaged };
  });
  ipcMain.handle("app:open-data", (event) => {
    requireTrusted(event);
    return shell.showItemInFolder(configPath);
  });
  ipcMain.handle("app:open-external", (event, url) => {
    requireTrusted(event);
    if (["https://ollama.com/download", "https://console.anthropic.com/settings/keys"].includes(url)) return shell.openExternal(url);
    throw new Error("That link is not allowed.");
  });
  ipcMain.handle("clipboard:write", (event, value) => {
    requireTrusted(event);
    clipboard.writeText(String(value || ""));
  });
  ipcMain.handle("secret:status", (event) => {
    requireTrusted(event);
    return secretStatus();
  });
  ipcMain.handle("secret:set", (event, value) => {
    requireTrusted(event);
    return storeAnthropicKey(value);
  });
  ipcMain.handle("secret:remove", (event) => {
    requireTrusted(event);
    return removeAnthropicKey();
  });
  ipcMain.handle("app:preferences", (event) => {
    requireTrusted(event);
    return preferences();
  });
  ipcMain.handle("app:set-theme", (event, theme) => {
    requireTrusted(event);
    const value = ["system", "light", "dark"].includes(theme) ? theme : "system";
    updateBehavior({ theme: value });
    applyTheme(value);
    return preferences();
  });
  ipcMain.handle("app:set-startup", (event, enabled) => {
    requireTrusted(event);
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
    return preferences();
  });
  ipcMain.handle("app:set-shortcut", (event, accelerator) => {
    requireTrusted(event);
    return registerOpenShortcut(accelerator);
  });
  ipcMain.on("window:minimize", (event) => {
    if (trusted(event)) mainWindow?.minimize();
  });
  ipcMain.on("window:maximize", (event) => {
    if (!trusted(event)) return;
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });
  ipcMain.on("window:hide", (event) => {
    if (trusted(event)) mainWindow?.hide();
  });
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
  if (trayTimer) clearInterval(trayTimer);
  stopRuntime();
});

app.whenReady().then(async () => {
  app.setAppUserModelId("com.relay.desktop");
  Menu.setApplicationMenu(null);
  prepareConfig();
  await prepareSecrets();
  const behavior = loadServiceConfig().behavior || {};
  applyTheme(behavior.theme || "system");
  openShortcut = behavior.openShortcut || "Control+Alt+T";
  registerIpc();
  startRuntime();
  createWindow();
  createTray();
  registerOpenShortcut(openShortcut, false);
  setTimeout(() => syncHelperBehavior().catch(() => {}), 900);
  nativeTheme.on("updated", () => {
    const info = preferences();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("theme", info);
  });
  setupUpdates();
});
