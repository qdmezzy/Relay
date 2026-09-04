import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_PATH, loadConfig, saveConfig, readConfigFile } from "./config.js";
import { createProvider } from "./providers/index.js";
import { translate } from "./translate.js";
import { remember, stats as memoryStats } from "./memory.js";
import { verifyMeaning } from "./verify.js";

const startupConfig = loadConfig();
const PORT = startupConfig.port || 8765;
const HOST = "127.0.0.1";

let backend = { state: "checking", name: "", message: "Checking your translator…" };
let runtime = {
  autoLang: "",
  autoProc: "",
  targetProc: "",
  sendMode: "instant",
  previewReady: false,
  selectionPopupEnabled: true,
  safetyPaused: false,
  safetyReason: "",
  message: "",
  lastSeen: 0,
};
let commandId = Date.now();
const commandQueue = [];
let pullState = { state: "idle", completed: 0, total: 0, percent: 0, message: "" };
const HISTORY_PATH = process.env.RELAY_HISTORY
  ? path.resolve(process.env.RELAY_HISTORY)
  : path.join(path.dirname(CONFIG_PATH), "history.json");

function historyEnabled() {
  return loadConfig().behavior?.historyEnabled !== false;
}

function readHistory() {
  try {
    const value = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  const temp = HISTORY_PATH + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(items, null, 2) + "\n", "utf8");
  fs.renameSync(temp, HISTORY_PATH);
}

function recordHistory({ source, translation, target, origin, app }) {
  if (!historyEnabled() || !origin || origin === "setup") return;
  const item = {
    id: randomUUID(),
    source: cleanText(source, 2000),
    translation: cleanText(translation, 4000),
    target: cleanText(target, 10),
    origin: cleanText(origin, 30),
    app: cleanText(app, 180),
    createdAt: new Date().toISOString(),
  };
  if (!item.source || !item.translation) return;
  try {
    writeHistory([item, ...readHistory()].slice(0, 100));
  } catch {}
}

function clearHistory() {
  if (fs.existsSync(HISTORY_PATH)) fs.rmSync(HISTORY_PATH);
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  const buf = Buffer.from(body, "utf8");
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": buf.length,
    "Cache-Control": "no-store",
  });
  res.end(buf);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Message too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  return JSON.parse(await readBody(req));
}

function publicConfig(config) {
  const copy = structuredClone(config);
  if (copy.providers?.anthropic) {
    delete copy.providers.anthropic.apiKey;
  }
  return copy;
}

function cleanText(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function applyConfig(input) {
  const next = structuredClone(readConfigFile());
  const providers = ["ollama", "anthropic"];
  const speech = ["masculine", "masculine-neutral", "neutral", "feminine"];
  const efforts = ["low", "medium", "high"];
  const themes = ["system", "light", "dark"];
  const sendModes = ["instant", "review"];
  const registers = {
    ko: ["banmal", "haeyo", "formal"],
    ja: ["tameguchi", "teineigo", "keigo"],
    fr: ["tu_familier", "tu_neutre", "vous"],
  };

  if (providers.includes(input.provider)) next.provider = input.provider;

  if (input.you && typeof input.you === "object") {
    next.you = next.you || {};
    const name = cleanText(input.you.name, 60);
    if (name) next.you.name = name;
    if (speech.includes(input.you.speech)) next.you.speech = input.you.speech;
    if (Array.isArray(input.you.style)) {
      next.you.style = input.you.style
        .map((line) => cleanText(line, 240))
        .filter(Boolean)
        .slice(0, 30);
    }
  }

  if (input.providers?.ollama) {
    next.providers = next.providers || {};
    next.providers.ollama = next.providers.ollama || {};
    const host = cleanText(input.providers.ollama.host, 300);
    const model = cleanText(input.providers.ollama.model, 120);
    if (host && /^https?:\/\//i.test(host)) next.providers.ollama.host = host;
    if (model) next.providers.ollama.model = model;
  }

  if (input.providers?.anthropic) {
    next.providers = next.providers || {};
    next.providers.anthropic = next.providers.anthropic || {};
    const model = cleanText(input.providers.anthropic.model, 120);
    if (model) next.providers.anthropic.model = model;
    if (efforts.includes(input.providers.anthropic.effort)) {
      next.providers.anthropic.effort = input.providers.anthropic.effort;
    }

  }

  if (next.providers?.anthropic) delete next.providers.anthropic.apiKey;

  if (input.behavior && typeof input.behavior === "object") {
    next.behavior = next.behavior || {};
    if (themes.includes(input.behavior.theme)) next.behavior.theme = input.behavior.theme;
    if (sendModes.includes(input.behavior.sendMode)) next.behavior.sendMode = input.behavior.sendMode;
    if (typeof input.behavior.onboardingComplete === "boolean") {
      next.behavior.onboardingComplete = input.behavior.onboardingComplete;
    }
    if (typeof input.behavior.historyEnabled === "boolean") {
      next.behavior.historyEnabled = input.behavior.historyEnabled;
    }
    if (typeof input.behavior.selectionPopupEnabled === "boolean") {
      next.behavior.selectionPopupEnabled = input.behavior.selectionPopupEnabled;
    }
    if (Array.isArray(input.behavior.allowedApps)) {
      const seen = new Set();
      next.behavior.allowedApps = input.behavior.allowedApps
        .map((app) => cleanText(app, 180))
        .filter((app) => {
          const key = app.toLowerCase();
          if (!app || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 30);
    }
    const lastLanguage = cleanText(input.behavior.lastLanguage, 10);
    if (["ko", "ja", "fr"].includes(lastLanguage)) next.behavior.lastLanguage = lastLanguage;
    const shortcut = cleanText(input.behavior.openShortcut, 80);
    if (shortcut) next.behavior.openShortcut = shortcut;
  }

  next.profiles = next.profiles || {};
  for (const lang of Object.keys(registers)) {
    const profile = input.profiles?.[lang];
    if (!profile || !registers[lang].includes(profile.register)) continue;
    next.profiles[lang] = next.profiles[lang] || { lang, default: true };
    next.profiles[lang].register = profile.register;
  }

  return saveConfig(next);
}

async function pullModel() {
  if (pullState.state === "downloading") return;
  const config = loadConfig();
  const host = config.providers?.ollama?.host || "http://127.0.0.1:11434";
  const model = config.providers?.ollama?.model || "translategemma:4b";
  pullState = {
    state: "downloading",
    completed: 0,
    total: 0,
    percent: 0,
    message: "Preparing " + model + "…",
  };

  try {
    const response = await fetch(host.replace(/\/+$/, "") + "/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!response.ok || !response.body) {
      throw new Error((await response.text()) || "Ollama could not download that model");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    const updatePull = (line) => {
      if (!line.trim()) return;
      const item = JSON.parse(line);
      if (item.error) throw new Error(item.error);
      const completed = Number(item.completed || 0);
      const total = Number(item.total || 0);
      pullState = {
        state: "downloading",
        completed,
        total,
        percent: total ? Math.min(100, Math.round((completed / total) * 100)) : pullState.percent,
        message: item.status || "Downloading " + model + "…",
      };
    };
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) updatePull(line);
      if (done) break;
    }
    updatePull(pending);

    pullState = { state: "ready", completed: 0, total: 0, percent: 100, message: model + " is ready" };
    await checkBackend();
  } catch (error) {
    pullState = {
      state: "error",
      completed: 0,
      total: 0,
      percent: 0,
      message: error?.message || "The model download failed",
    };
  }
}

async function checkBackend() {
  backend = { state: "checking", name: "", message: "Checking your translator…" };
  try {
    const config = loadConfig();
    const provider = await createProvider(config);
    await provider.healthcheck();
    backend = { state: "ready", name: provider.name, message: "Ready to translate" };
  } catch (error) {
    backend = {
      state: "error",
      name: "",
      message: error?.message || "The translator is not ready",
    };
  }
  return backend;
}

function statusPayload() {
  const config = loadConfig();
  const provider = config.provider || "ollama";
  return {
    service: "ready",
    backend,
    runtime: {
      ...runtime,
      helperConnected: Date.now() - runtime.lastSeen < 5000,
    },
    provider,
    model: config.providers?.[provider]?.model || "",
  };
}

async function handleTranslate(req, res) {
  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    return send(res, 400, "bad request: " + error.message);
  }

  const { text, target, profile, origin, app } = payload;
  if (!target) return send(res, 400, "missing target language");

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const result = await translate({ text, target, profile, signal: controller.signal });
    if (!result.skipped) {
      recordHistory({ source: text, translation: result.text, target, origin, app });
    }
    const cost = result.usage?.cost;
    console.log(
      "[" + new Date().toLocaleTimeString() + "] -> " + target +
        (result.ms ? "  " + result.ms + "ms" : "") +
        (cost ? "  $" + cost.toFixed(5) : "") +
        (result.skipped ? "  (" + result.skipped + ")" : "") +
        (result.warnings?.length ? "  ! " + result.warnings.join("; ") : "")
    );
    send(res, 200, result.text);
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error("[error]", error.message);
    send(res, 500, error.message);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + HOST + ":" + PORT);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, "ok");
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, statusPayload());
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    return sendJson(res, 200, publicConfig(loadConfig()));
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    try {
      const saved = applyConfig(await readJson(req));
      checkBackend();
      return sendJson(res, 200, publicConfig(saved));
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/backend/recheck") {
    return sendJson(res, 200, await checkBackend());
  }

  if (req.method === "GET" && url.pathname === "/api/backend/pull") {
    return sendJson(res, 200, pullState);
  }

  if (req.method === "POST" && url.pathname === "/api/backend/pull") {
    pullModel();
    return sendJson(res, 202, pullState);
  }

  if (req.method === "POST" && url.pathname === "/api/control") {
    try {
      const payload = await readJson(req);
      const actions = ["auto", "auto-target", "auto-off", "read-selection", "selection-popup", "safety-apps", "send-mode"];
      if (!actions.includes(payload.action)) {
        return sendJson(res, 400, { error: "unknown control action" });
      }
      commandId += 1;
      const command = {
        id: commandId,
        action: payload.action,
        value: cleanText(payload.value, payload.action === "safety-apps" ? 3000 : 240),
      };
      commandQueue.push(command);
      if (commandQueue.length > 100) commandQueue.shift();
      return sendJson(res, 202, command);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/control") {
    const after = Number(url.searchParams.get("after") || 0);
    const command = commandQueue.find((item) => item.id > after);
    if (!command) return send(res, 200, "");
    return send(
      res,
      200,
      command.id + "\t" + command.action + "\t" + command.value
    );
  }

  if (req.method === "POST" && url.pathname === "/api/runtime") {
    try {
      const payload = await readJson(req);
      runtime = {
        autoLang: cleanText(payload.autoLang, 10),
        autoProc: cleanText(payload.autoProc, 180),
        targetProc: cleanText(payload.targetProc, 180),
        sendMode: payload.sendMode === "review" ? "review" : "instant",
        previewReady: Boolean(payload.previewReady),
        selectionPopupEnabled: payload.selectionPopupEnabled !== false,
        safetyPaused: Boolean(payload.safetyPaused),
        safetyReason: cleanText(payload.safetyReason, 180),
        message: cleanText(payload.message, 300),
        lastSeen: Date.now(),
      };
      return sendJson(res, 200, runtime);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/memory") {
    return sendJson(res, 200, memoryStats());
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    return sendJson(res, 200, { enabled: historyEnabled(), items: readHistory() });
  }

  if (req.method === "DELETE" && url.pathname === "/api/history") {
    clearHistory();
    return sendJson(res, 200, { cleared: true });
  }

  // a translation i corrected by hand. goes in the bank so the next message
  // that looks like it gets shown the fixed version instead of guessing again.
  if (req.method === "POST" && url.pathname === "/api/memory") {
    try {
      const payload = await readJson(req);
      const saved = remember(payload.lang, payload.source, payload.translation);
      return sendJson(res, saved.saved ? 200 : 400, saved);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  // takes the translation back to english so the review popup can show me what
  // it actually says. separate call on purpose - the draft shows up straight
  // away and this fills in a moment later instead of holding it up.
  if (req.method === "POST" && url.pathname === "/api/verify") {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const payload = await readJson(req);
      if (!payload.target) return sendJson(res, 400, { error: "missing target language" });
      const checked = await verifyMeaning({
        text: payload.text,
        translation: payload.translation,
        target: payload.target,
        signal: controller.signal,
        repair: payload.repair !== false,
      });
      return sendJson(res, 200, checked);
    } catch (error) {
      if (controller.signal.aborted) return;
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/translate") {
    return handleTranslate(req, res);
  }

  return send(res, 404, "not found");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is already in use.");
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log("Relay service listening on " + HOST + ":" + PORT);
  checkBackend();
});
