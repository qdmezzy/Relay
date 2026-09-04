

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_PORT = 11499;
const APP_PORT = 8799;

let lastSystem = "", lastUser = "", lastMessages = [], reply = "";

const fakeOllama = http.createServer((req, res) => {
  if (req.url === "/api/tags") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ models: [{ name: "translategemma:4b" }] }));
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const p = JSON.parse(body);
    lastMessages = p.messages;
    lastSystem = p.messages[0].content;

    lastUser = p.messages[p.messages.length - 1].content;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      message: { content: reply },
      prompt_eval_count: 900, eval_count: 20,
    }));
  });
});

const cfgPath = path.join(ROOT, "config.json");
const original = fs.readFileSync(cfgPath, "utf8");
const test = JSON.parse(original);
test.port = APP_PORT;
// pin the local backend. this used to inherit whatever provider config.json
// had, so running the tests with the paid one selected pointed them at the
// real api and spent real money to check a fake reply came back
test.provider = "ollama";
test.providers.ollama.host = "http://127.0.0.1:" + FAKE_PORT;

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { console.log("  ok   " + name); pass++; }
  else { console.log("  FAIL " + name + (extra ? "\n       " + extra : "")); fail++; }
};

async function post(payload) {
  const res = await fetch("http://127.0.0.1:" + APP_PORT + "/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, text: await res.text() };
}

await new Promise((r) => fakeOllama.listen(FAKE_PORT, "127.0.0.1", r));
fs.writeFileSync(cfgPath, JSON.stringify(test, null, 2));

const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
});
const logs = [];
server.stdout.on("data", (d) => logs.push(d.toString()));
server.stderr.on("data", (d) => logs.push(d.toString()));

for (let i = 0; i < 50; i++) {
  try { const r = await fetch("http://127.0.0.1:" + APP_PORT + "/health"); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

try {
  console.log("\ndaemon end-to-end");

  reply = "ㅇㅇ 나 지금 개바빠 ㅠㅠ";
  let r = await post({ target: "ko", text: "yeah im so busy rn :(" });
  check("returns UTF-8 korean intact", r.text === reply, "got: " + r.text);
  check("status 200", r.status === 200);
  check("system prompt carries the register", lastSystem.includes("반말"));

  reply = "⟦0⟧ 봤어? ⟦1⟧";
  r = await post({ target: "ko", text: "<@123> did you see this? https://x.co/a" });
  check("mentions and urls survive the round trip",
    r.text === "<@123> 봤어? https://x.co/a", "got: " + r.text);
  check("model never saw the raw url", !lastUser.includes("https://x.co/a"));

  reply = 'Korean: "야 뭐해"';
  r = await post({ target: "ko", text: "yo wyd" });
  check("strips a label and wrapping quotes", r.text === "야 뭐해", "got: " + r.text);

  reply = "```\nおつかれ\n```";
  r = await post({ target: "ja", text: "gg" });
  check("strips a fenced wrapper", r.text === "おつかれ", "got: " + r.text);

  reply = "<think>hmm the register here is casual</think>ouais carrément";
  r = await post({ target: "fr", text: "yeah totally" });
  check("strips leaked reasoning blocks", r.text === "ouais carrément", "got: " + r.text);

  reply = "IGNORED";
  r = await post({ target: "ko", text: "https://x.co/a" });
  check("skips a message that is only a url", r.text === "https://x.co/a", "got: " + r.text);

  reply = "so what are you up to";
  r = await post({ target: "en", text: "ㅇㅇ 뭐해?" });
  check("english direction uses the reader prompt", lastSystem.includes("into English"));
  check("english direction detected the source", lastSystem.includes("from Korean"));

  r = await post({ target: "ko", text: "   " });
  check("empty input returns empty, no model call", r.text === "");

  r = await post({ target: "zz", text: "hi" });
  check("unknown language is a clean 500", r.status === 500 && /Unknown language/.test(r.text),
    r.status + " " + r.text);

  r = await post({ text: "hi" });
  check("missing target is a 400", r.status === 400);

  const emoji = "😭😭 wait fr??";
  reply = "⟦0⟧⟦1⟧ 진짜??";
  r = await post({ target: "ko", text: emoji });
  check("emoji are hidden from the model", !/[\u{1F300}-\u{1FAFF}]/u.test(lastUser),
    "model saw: " + lastUser);
  check("emoji come back intact anyway", r.text === "😭😭 진짜??", "got: " + r.text);

  reply = "⟦0⟧ 좋아";
  r = await post({ target: "ko", text: "👍🏽 nice" });
  check("skin-tone modifier stays with its emoji", r.text === "👍🏽 좋아", "got: " + r.text);

  check("few-shot examples are sent as conversation turns", lastMessages.length > 2,
    "only " + lastMessages.length + " messages sent");
  check("few-shot alternates user/assistant and ends on the real message",
    lastMessages.slice(1, -1).every((m, i) => m.role === (i % 2 === 0 ? "user" : "assistant")) &&
    lastMessages[lastMessages.length - 1].role === "user");

  reply = "안녕";
  r = await post({ target: "ko", text: "ㅇㅇ 알았어" });
  check("skips a message already in the target language", r.text === "ㅇㅇ 알았어", "got: " + r.text);

  console.log("\n" + pass + " passed, " + fail + " failed\n");
} finally {
  server.kill();
  fakeOllama.close();
  fs.writeFileSync(cfgPath, original);
}

process.exit(fail ? 1 : 0);
