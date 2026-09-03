import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_OLLAMA = 11498;
const PORT = 8798;
const BASE = "http://127.0.0.1:" + PORT;

let reply = "";
let lastMessages = [];

const fakeOllama = http.createServer((req, res) => {
  if (req.url === "/api/tags") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    lastMessages = JSON.parse(body).messages;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: { content: reply }, prompt_eval_count: 900, eval_count: 20 }));
  });
});

const cfgPath = path.join(ROOT, "config.json");
const originalConfig = fs.readFileSync(cfgPath, "utf8");
const testConfig = JSON.parse(originalConfig);
testConfig.port = PORT;
testConfig.providers.ollama.host = "http://127.0.0.1:" + FAKE_OLLAMA;

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { console.log("  ok   " + name); pass++; }
  else { console.log("  FAIL " + name + (extra ? "\n       " + extra : "")); fail++; }
};

const get = async (p) => {
  const r = await fetch(BASE + p);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
};

const send = async (p, body, method = "POST") => {
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
};

await new Promise((r) => fakeOllama.listen(FAKE_OLLAMA, "127.0.0.1", r));
fs.writeFileSync(cfgPath, JSON.stringify(testConfig, null, 2));

const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});

for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE + "/health")).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

try {
  console.log("\nflow: app starts up");
  check("health responds", (await get("/health")).text === "ok");
  const status = await get("/api/status");
  check("status reports the backend", status.status === 200 && status.json !== null,
    status.text.slice(0, 120));

  console.log("\nflow: turn on auto translate from the app window");
  let cursor = 0;
  const queued = await send("/api/control", { action: "auto", value: "ko" });
  check("app queues the command", queued.status === 202 && queued.json.action === "auto");

  let polled = await get("/api/control?after=" + cursor);
  check("helper receives it", polled.text.includes("\tauto\tko"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  polled = await get("/api/control?after=" + cursor);
  check("same command is not delivered twice", polled.text === "", "got: " + polled.text);

  console.log("\nflow: helper reports what it is doing");
  const pushed = await send("/api/runtime", {
    autoLang: "ko", autoProc: "Discord.exe", highlight: false,
    targetProc: "Discord.exe", message: "",
  });
  check("runtime state is accepted", pushed.status === 200 && pushed.json.autoLang === "ko");
  const after = await get("/api/status");
  check("app window can read that state back",
    JSON.stringify(after.json).includes("Discord.exe"), after.text.slice(0, 200));

  console.log("\nflow: send a message with auto translate on");
  reply = "나 이제 잔다";
  const sent = await send("/translate", { target: "ko", text: "im going to bed now" });
  check("draft comes back translated", sent.text === "나 이제 잔다", "got: " + sent.text);
  check("the model was given few-shot examples", lastMessages.length > 2);

  console.log("\nflow: highlight a message to read it");
  const hl = await send("/api/control", { action: "highlight", value: "on" });
  check("highlight command queues", hl.status === 202 && hl.json.action === "highlight");
  polled = await get("/api/control?after=" + cursor);
  check("helper receives highlight on", polled.text.includes("\thighlight\ton"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  reply = "im washed";
  const read = await send("/translate", { target: "en", text: "나 한물 갔어" });
  check("selection reads back in english", read.text === "im washed", "got: " + read.text);

  console.log("\nflow: turn auto translate off");
  await send("/api/control", { action: "auto-off" });
  polled = await get("/api/control?after=" + cursor);
  check("helper receives auto-off", polled.text.includes("\tauto-off"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  await send("/api/runtime", { autoLang: "", autoProc: "", highlight: false, targetProc: "Discord.exe", message: "" });
  const off = await get("/api/status");
  check("state shows auto is off", !JSON.stringify(off.json).includes('"autoLang":"ko"'));

  console.log("\nflow: change settings in the app");
  const cfg = await get("/api/config");
  check("config loads", cfg.status === 200 && cfg.json.you !== undefined, cfg.text.slice(0, 120));
  check("config never exposes the api key itself",
    cfg.json.providers?.anthropic?.apiKey === undefined,
    "api key leaked to the renderer");

  console.log("\nflow: paste an api key to use the paid backend");
  const withKey = structuredClone(cfg.json);
  withKey.providers.anthropic.apiKey = "sk-ant-test-do-not-use";
  const keySaved = await send("/api/config", withKey, "PUT");
  check("key saves", keySaved.status === 200, keySaved.text.slice(0, 160));
  check("saved key is never sent back",
    !keySaved.text.includes("sk-ant-test-do-not-use"), "key echoed to the window");
  check("window is told a key exists", keySaved.json.providers.anthropic.hasApiKey === true);

  const reread = await get("/api/config");
  check("key still hidden on reload", !reread.text.includes("sk-ant-test-do-not-use"));
  check("hasApiKey survives a reload", reread.json.providers.anthropic.hasApiKey === true);

  const blind = structuredClone(reread.json);
  blind.providers.anthropic.model = "claude-opus-5";
  await send("/api/config", blind, "PUT");
  check("saving other settings does not wipe the key",
    (await get("/api/config")).json.providers.anthropic.hasApiKey === true);

  const cleared = structuredClone(reread.json);
  cleared.providers.anthropic.apiKey = null;
  await send("/api/config", cleared, "PUT");
  check("sending null removes the key",
    (await get("/api/config")).json.providers.anthropic.hasApiKey === false);

  const onDisk = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  check("removed key is gone from disk too",
    onDisk.providers?.anthropic?.apiKey === undefined,
    "still on disk: " + JSON.stringify(onDisk.providers?.anthropic));

  const edited = structuredClone(cfg.json);
  edited.profiles.ko.register = "haeyo";
  const saved = await send("/api/config", edited, "PUT");
  check("settings save", saved.status === 200, saved.text.slice(0, 160));

  reply = "저 이제 자요";
  await send("/translate", { target: "ko", text: "im going to bed now" });
  const sys = lastMessages[0].content;
  check("a register change reaches the prompt without a restart", sys.includes("해요체"),
    "prompt still on the old register");

  edited.profiles.ko.register = "banmal";
  await send("/api/config", edited, "PUT");

  console.log("\nflow: bad input does not take the app down");
  check("unknown control action is rejected",
    (await send("/api/control", { action: "explode" })).status === 400);
  check("missing target is rejected", (await send("/translate", { text: "hi" })).status === 400);
  check("unknown route is a 404", (await get("/nope")).status === 404);
  check("service still healthy afterwards", (await get("/health")).text === "ok");

  console.log("\n" + pass + " passed, " + fail + " failed\n");
} finally {
  server.kill();
  fakeOllama.close();
  fs.writeFileSync(cfgPath, originalConfig);
}

process.exit(fail ? 1 : 0);
