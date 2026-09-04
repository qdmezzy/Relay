import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
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
    return res.end(JSON.stringify({ models: [{ name: "translategemma:4b" }] }));
  }
  if (req.url === "/api/pull") {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      res.write(JSON.stringify({ status: "pulling manifest", completed: 1, total: 2 }) + "\n");
      res.end(JSON.stringify({ status: "success", completed: 2, total: 2 }) + "\n");
    });
    return;
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
// pin the local backend - see the note in e2e.test.js
testConfig.provider = "ollama";
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

const memoryStore = path.join(os.tmpdir(), "relay-flows-memory-" + process.pid + ".json");
const historyStore = path.join(os.tmpdir(), "relay-flows-history-" + process.pid + ".json");
const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, RELAY_MEMORY: memoryStore, RELAY_HISTORY: historyStore },
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
  check("command ids survive a service restart", Number(polled.text.split("\t")[0]) > 1_000_000_000_000);
  cursor = Number(polled.text.split("\t")[0]);

  const targeted = await send("/api/control", { action: "auto-target", value: "ja|Discord.exe" });
  check("app can lock translation to one app", targeted.status === 202);
  polled = await get("/api/control?after=" + cursor);
  check("helper receives the locked app", polled.text.includes("\tauto-target\tja|Discord.exe"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  const reviewMode = await send("/api/control", { action: "send-mode", value: "review" });
  check("review before sending can be enabled", reviewMode.status === 202);
  polled = await get("/api/control?after=" + cursor);
  check("helper receives review mode", polled.text.includes("\tsend-mode\treview"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  const selectionOption = await send("/api/control", { action: "selection-popup", value: "true" });
  check("selected text popup can be enabled in the app", selectionOption.status === 202);
  polled = await get("/api/control?after=" + cursor);
  check("helper receives the popup preference", polled.text.includes("\tselection-popup\ttrue"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  await send("/api/control", { action: "safety-apps", value: "Discord.exe|Chrome.exe" });
  await send("/api/control", { action: "read-selection", value: "" });
  polled = await get("/api/control?after=" + cursor);
  check("rapid helper commands stay queued", polled.text.includes("\tsafety-apps\tDiscord.exe|Chrome.exe"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);
  polled = await get("/api/control?after=" + cursor);
  check("selected text popup command is not lost", polled.text.includes("\tread-selection\t"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  polled = await get("/api/control?after=" + cursor);
  check("same command is not delivered twice", polled.text === "", "got: " + polled.text);

  console.log("\nflow: helper reports what it is doing");
  const pushed = await send("/api/runtime", {
    autoLang: "ko", autoProc: "Discord.exe",
    targetProc: "Discord.exe", sendMode: "review", previewReady: true,
    selectionPopupEnabled: true,
    safetyPaused: true, safetyReason: "Password field", message: "",
  });
  check("runtime state is accepted", pushed.status === 200 && pushed.json.autoLang === "ko");
  check("review draft state is accepted", pushed.json.previewReady === true);
  check("selected text popup state is accepted", pushed.json.selectionPopupEnabled === true);
  check("safety pause state is accepted", pushed.json.safetyReason === "Password field");
  const after = await get("/api/status");
  check("app window can read that state back",
    JSON.stringify(after.json).includes("Discord.exe"), after.text.slice(0, 200));

  console.log("\nflow: send a message with auto translate on");
  reply = "나 이제 잔다";
  const sent = await send("/translate", { target: "ko", text: "im going to bed now" });
  check("draft comes back translated", sent.text === "나 이제 잔다", "got: " + sent.text);
  check("the model was given few-shot examples", lastMessages.length > 2);

  console.log("\nflow: selected text popup");
  const hl = await send("/api/control", { action: "read-selection", value: "" });
  check("popup command queues", hl.status === 202 && hl.json.action === "read-selection");
  polled = await get("/api/control?after=" + cursor);
  check("helper receives the popup command", polled.text.includes("\tread-selection\t"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  reply = "im washed";
  const read = await send("/translate", { target: "en", text: "나 한물 갔어", origin: "selection", app: "Discord.exe" });
  check("selection reads back in english", read.text === "im washed", "got: " + read.text);

  const history = await get("/api/history");
  check("translation history stays available locally", history.json.items[0]?.translation === "im washed", history.text);
  check("history keeps the source app", history.json.items[0]?.app === "Discord.exe", history.text);
  const cleared = await send("/api/history", undefined, "DELETE");
  check("history can be cleared", cleared.json.cleared === true);
  check("cleared history stays empty", (await get("/api/history")).json.items.length === 0);

  console.log("\nflow: check what the draft actually says before sending it");
  reply = "I am not angry.";
  const faithful = await send("/api/verify", {
    target: "ko", text: "im not mad", translation: "나 화 안 났어",
  });
  check("it reads the draft back in english", faithful.json.meaning === "I am not angry.", faithful.text);
  check("a faithful translation passes", faithful.json.verdict === "ok", faithful.text);

  reply = "I have been dating my girlfriend for 2 weeks.";
  const drifted = await send("/api/verify", {
    target: "ja", text: "ive had her for two weeks", translation: "彼女と2週間付き合ってる",
  });
  check("a meaning it invented gets caught", drifted.json.verdict !== "ok", drifted.text);
  check("it says what changed", (drifted.json.summary || "").length > 0, drifted.text);

  reply = "I am not angry.";
  const flipped = await send("/api/verify", {
    target: "ko", text: "im mad", translation: "나 화 안 났어",
  });
  check("a flipped negative gets caught", flipped.json.verdict === "bad", flipped.text);

  check("verify needs a target", (await send("/api/verify", { text: "hi" })).status === 400);

  console.log("\nflow: fix a translation that came out wrong");
  const bankBefore = await get("/api/memory");
  check("the bank starts empty", bankBefore.json.ko === 0, bankBefore.text);
  const fixed = await send("/api/memory", {
    lang: "ko", source: "wanna play minecraft tonight?", translation: "오늘 밤에 마크 할래?",
  });
  check("a correction saves", fixed.status === 200 && fixed.json.saved === true, fixed.text);
  const bankAfter = await get("/api/memory");
  check("the bank grew", bankAfter.json.ko === 1, bankAfter.text);

  reply = "오늘 밤에 마크 할래?";
  await send("/translate", { target: "ko", text: "wanna play minecraft later?" });
  const shown = lastMessages.map((m) => m.content).join("\n");
  check("the fix is shown to the model next time something similar is typed",
    shown.includes("오늘 밤에 마크 할래?"), "correction never made it into the prompt");

  check("saving junk is refused", (await send("/api/memory", { lang: "ko", source: "" })).status === 400);

  console.log("\nflow: turn auto translate off");
  await send("/api/control", { action: "auto-off" });
  polled = await get("/api/control?after=" + cursor);
  check("helper receives auto-off", polled.text.includes("\tauto-off"), "got: " + polled.text);
  cursor = Number(polled.text.split("\t")[0]);

  await send("/api/runtime", { autoLang: "", autoProc: "", targetProc: "Discord.exe", message: "" });
  const off = await get("/api/status");
  check("state shows auto is off", !JSON.stringify(off.json).includes('"autoLang":"ko"'));

  console.log("\nflow: change settings in the app");
  const cfg = await get("/api/config");
  check("config loads", cfg.status === 200 && cfg.json.you !== undefined, cfg.text.slice(0, 120));
  check("config never exposes the api key itself",
    cfg.json.providers?.anthropic?.apiKey === undefined,
    "api key leaked to the renderer");

  console.log("\nflow: api keys never enter the normal settings file");
  const withKey = structuredClone(cfg.json);
  withKey.providers.anthropic.apiKey = "sk-ant-test-do-not-use";
  const keySaved = await send("/api/config", withKey, "PUT");
  check("settings request succeeds", keySaved.status === 200, keySaved.text.slice(0, 160));
  check("key is never sent back",
    !keySaved.text.includes("sk-ant-test-do-not-use"), "key echoed to the window");
  const onDisk = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  check("key is not written to plain text on disk",
    onDisk.providers?.anthropic?.apiKey === undefined,
    "still on disk: " + JSON.stringify(onDisk.providers?.anthropic));

  const behavior = structuredClone(keySaved.json);
  behavior.behavior = {
    theme: "dark",
    sendMode: "review",
    openShortcut: "Control+Shift+Space",
    lastLanguage: "fr",
    selectionPopupEnabled: false,
    historyEnabled: false,
    allowedApps: ["Discord.exe", "discord.exe", "Chrome.exe"],
    onboardingComplete: true,
  };
  const behaviorSaved = await send("/api/config", behavior, "PUT");
  check("desktop preferences save", behaviorSaved.json.behavior.theme === "dark" && behaviorSaved.json.behavior.sendMode === "review");
  check("history preference saves", behaviorSaved.json.behavior.historyEnabled === false);
  check("selected text popup preference saves", behaviorSaved.json.behavior.selectionPopupEnabled === false);
  check("allowed apps are deduplicated", behaviorSaved.json.behavior.allowedApps.length === 2);

  console.log("\nflow: download an Ollama model during setup");
  const pulling = await send("/api/backend/pull", {});
  check("model download starts", pulling.status === 202);
  let pullStatus;
  for (let i = 0; i < 30; i++) {
    pullStatus = await get("/api/backend/pull");
    if (pullStatus.json?.state !== "downloading") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  check("download reaches ready", pullStatus.json?.state === "ready", pullStatus.text);

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
  fs.rmSync(historyStore, { force: true });
  fs.writeFileSync(cfgPath, originalConfig);
}

process.exit(fail ? 1 : 0);
