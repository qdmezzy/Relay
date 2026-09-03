import http from "node:http";
import { loadConfig, saveConfig, readConfigFile, keyFromEnvironment } from "./config.js";
import { createProvider } from "./providers/index.js";
import { translate } from "./translate.js";

const startupConfig = loadConfig();
const PORT = startupConfig.port || 8765;
const HOST = "127.0.0.1";

let backend = { state: "checking", name: "", message: "Checking your translator…" };
let runtime = {
  autoLang: "",
  autoProc: "",
  highlight: false,
  targetProc: "",
  message: "",
};
let commandId = 0;
let lastCommand = null;

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
    const saved = readConfigFile().providers?.anthropic?.apiKey;
    copy.providers.anthropic.hasApiKey = Boolean(saved) || keyFromEnvironment();
    copy.providers.anthropic.keyFromEnvironment = keyFromEnvironment();
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

    const key = input.providers.anthropic.apiKey;
    if (key === null) {
      delete next.providers.anthropic.apiKey;
    } else if (typeof key === "string" && key.trim()) {
      next.providers.anthropic.apiKey = key.trim();
    }
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
    runtime,
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

  const { text, target, profile } = payload;
  if (!target) return send(res, 400, "missing target language");

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const result = await translate({ text, target, profile, signal: controller.signal });
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

  if (req.method === "POST" && url.pathname === "/api/control") {
    try {
      const payload = await readJson(req);
      const actions = ["auto", "auto-off", "highlight"];
      if (!actions.includes(payload.action)) {
        return sendJson(res, 400, { error: "unknown control action" });
      }
      commandId += 1;
      lastCommand = {
        id: commandId,
        action: payload.action,
        value: cleanText(payload.value, 20),
      };
      return sendJson(res, 202, lastCommand);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/control") {
    const after = Number(url.searchParams.get("after") || 0);
    if (!lastCommand || lastCommand.id <= after) return send(res, 200, "");
    return send(
      res,
      200,
      lastCommand.id + "\t" + lastCommand.action + "\t" + lastCommand.value
    );
  }

  if (req.method === "POST" && url.pathname === "/api/runtime") {
    try {
      const payload = await readJson(req);
      runtime = {
        autoLang: cleanText(payload.autoLang, 10),
        autoProc: cleanText(payload.autoProc, 180),
        highlight: Boolean(payload.highlight),
        targetProc: cleanText(payload.targetProc, 180),
        message: cleanText(payload.message, 300),
      };
      return sendJson(res, 200, runtime);
    } catch (error) {
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
