const { contextBridge } = require("electron");

const config = {
  provider: "ollama",
  providers: {
    ollama: { model: "qwen3:8b", url: "http://127.0.0.1:11434" },
    anthropic: { model: "claude-opus-5", effort: "low" },
  },
  you: { name: "me", speechStyle: "masculine-neutral", interests: [], fillers: [], notes: [] },
  profiles: {
    ko: { lang: "ko", default: true, register: "banmal", glossary: {}, notes: [] },
    ja: { lang: "ja", default: true, register: "casual", glossary: {}, notes: [] },
    fr: { lang: "fr", default: true, register: "casual", glossary: {}, notes: [] },
    en: { lang: "en", default: true, register: "casual", glossary: {}, notes: [] },
  },
  behavior: {
    theme: "system",
    sendMode: "instant",
    openShortcut: "Control+Alt+T",
    lastLanguage: "ja",
    selectionPopupEnabled: true,
    historyEnabled: true,
    allowedApps: ["Discord.exe"],
    onboardingComplete: true,
  },
};

const status = {
  service: "ready",
  backend: { state: "ready", name: "Ollama", message: "Ready" },
  runtime: {
    autoLang: "",
    autoProc: "",
    targetProc: "Discord.exe",
    sendMode: "instant",
    previewReady: false,
    selectionPopupEnabled: true,
    safetyPaused: false,
    safetyReason: "",
    message: "",
    helperConnected: true,
  },
  provider: "ollama",
  model: "qwen3:8b",
};

contextBridge.exposeInMainWorld("typeTranslate", {
  request: async ({ path, method, body }) => {
    if (path === "/api/config") {
      if (method === "PUT" && body) Object.assign(config, body);
      return config;
    }
    if (path === "/api/status") return status;
    if (path === "/api/history") return { items: [] };
    if (path === "/api/control") return { id: Date.now(), action: body?.action || "" };
    if (path === "/api/backend/recheck") return status.backend;
    if (path === "/api/backend/pull") return { state: "idle", percent: 0 };
    if (path === "/translate") return "こんにちは";
    return {};
  },
  cancelRequest: async () => true,
  restartService: () => {},
  getMeta: async () => ({ version: "1.0.1", packaged: false }),
  openData: async () => {},
  openExternal: async () => {},
  copy: async () => {},
  getSecretStatus: async () => ({ hasKey: false, fromEnvironment: false }),
  saveSecret: async () => ({ hasKey: true, fromEnvironment: false }),
  removeSecret: async () => ({ hasKey: false, fromEnvironment: false }),
  getPreferences: async () => ({ dark: false, theme: "system", openShortcut: "Control+Alt+T", openAtLogin: false, startupSupported: true }),
  setTheme: async () => {},
  setStartup: async () => {},
  setOpenShortcut: async () => ({ ok: true, shortcut: "Control+Alt+T" }),
  onTheme: () => {},
  minimize: () => {},
  maximize: () => {},
  hide: () => {},
  onNavigate: () => {},
  onUpdate: () => {},
  checkUpdates: async () => {},
  installUpdate: async () => {},
});
