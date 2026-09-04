// turns the sweep's failures into example pairs.
//
//   node test/fix.js                    propose corrections, write candidates
//   node test/fix.js --apply            also merge them into src/examples.js
//   node test/fix.js --teacher=anthropic  use the paid backend as the teacher
//   node test/fix.js --max=40           cap how many it works on
//
// the teacher has to be a different, stronger model than the one that failed.
// retrying the same model does not work - "je sais pas" came back as "i know"
// identically at temperature 1.4 across different seeds. it is not unsure, it is
// wrong, and only an example fixes that.
//
// aya-expanse:8b is the default teacher because it is already pulled and it is
// strong where qwen is weak. --teacher=anthropic is better if you have a key.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { buildOutgoingSystem, buildIncomingSystem } from "../src/prompt.js";
import { EXAMPLES } from "../src/examples.js";
import { runChecks } from "./checks.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(HERE, ".sweep.json");
const CANDIDATES = path.join(HERE, ".fixes.json");
const EXAMPLES_FILE = path.join(HERE, "..", "src", "examples.js");
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", O = "\x1b[0m";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith("--" + n + "="));
  return hit ? hit.split("=")[1] : d;
};
const apply = args.includes("--apply");
const teacherName = flag("teacher", "ollama");
const teacherModel = flag("model", "aya-expanse:8b");
const max = Number(flag("max", 60));

if (!fs.existsSync(STATE)) {
  console.error("No sweep results. Run: node test/sweep.js");
  process.exit(1);
}
const { failures = [] } = JSON.parse(fs.readFileSync(STATE, "utf8"));
if (failures.length === 0) {
  console.log(G + "\n  nothing broken in the last sweep\n" + O);
  process.exit(0);
}

const config = loadConfig();

function systemFor(target) {
  if (target === "en") return buildIncomingSystem({ source: null, you: config.you });
  const profile = config.profiles?.[target] ?? {};
  return buildOutgoingSystem({ target, register: profile.register, you: config.you, profile });
}

function shotsFor(target) {
  return (EXAMPLES[target] ?? []).flatMap(([user, assistant]) => [
    { role: "user", content: user },
    { role: "assistant", content: assistant },
  ]);
}

async function askOllama(system, shots, user) {
  const host = (config.providers?.ollama?.host || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const res = await fetch(host + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: teacherModel,
      stream: false,
      think: false,
      messages: [{ role: "system", content: system }, ...shots, { role: "user", content: user }],
      options: { temperature: 0.3, num_predict: 400 },
    }),
  });
  if (!res.ok) throw new Error("teacher HTTP " + res.status);
  const json = await res.json();
  return (json?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function askAnthropic(system, shots, user) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const key = config.providers?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY;
  const client = new Anthropic(key ? { apiKey: key } : undefined);
  const res = await client.messages.create({
    model: config.providers?.anthropic?.model || "claude-opus-5",
    max_tokens: 2000,
    output_config: { effort: "low" },
    system,
    messages: [...shots, { role: "user", content: user }],
  });
  return res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

const ask = teacherName === "anthropic" ? askAnthropic : askOllama;

// one failure per (language, problem) shape is enough - the corpus repeats each
// pattern across dozens of wordings and they all get fixed by the same example
const buckets = new Map();
for (const failure of failures) {
  const shape = failure.lang + "|" + failure.problems[0].replace(/\d+/g, "N");
  if (!buckets.has(shape)) buckets.set(shape, []);
  buckets.get(shape).push(failure);
}

const work = [];
for (const list of buckets.values()) {
  work.push(...list.slice(0, 3));
}
const shortlist = work.slice(0, max);

console.log(
  "\n  " + failures.length + " failures, " + buckets.size + " distinct shapes" +
    "\n  fixing " + shortlist.length + " with " + Y + (teacherName === "anthropic" ? "anthropic" : teacherModel) + O + "\n"
);

const candidates = [];
let fixed = 0, stubborn = 0;

for (const [index, failure] of shortlist.entries()) {
  process.stdout.write(D + "  " + (index + 1) + "/" + shortlist.length + "  " + failure.input.slice(0, 44) + "        \r" + O);
  try {
    const better = await ask(systemFor(failure.lang), shotsFor(failure.lang), failure.input);
    const problems = runChecks(better, { source: failure.input, target: failure.lang });
    if (problems.length === 0 && better && better !== failure.out) {
      candidates.push({ lang: failure.lang, user: failure.input, assistant: better, was: failure.out, problems: failure.problems });
      fixed++;
    } else {
      stubborn++;
    }
  } catch (error) {
    process.stdout.write("\r" + R + "  teacher failed: " + error.message + O + "\n");
    stubborn++;
  }
}
process.stdout.write("\r" + " ".repeat(70) + "\r");

fs.writeFileSync(CANDIDATES, JSON.stringify(candidates, null, 2));

console.log("=".repeat(70));
console.log("  " + G + fixed + " corrected" + O + "   " + (stubborn ? R : D) + stubborn + " the teacher could not fix either" + O);
console.log("=".repeat(70) + "\n");

for (const c of candidates.slice(0, 25)) {
  console.log("  " + D + "[" + c.lang + "] " + c.problems.join(", ") + O);
  console.log("    " + c.user);
  console.log("    " + R + "was  " + c.was + O);
  console.log("    " + G + "now  " + c.assistant + O);
}
if (candidates.length > 25) console.log(D + "\n  ... and " + (candidates.length - 25) + " more in test/.fixes.json" + O);

if (!apply) {
  console.log(Y + "\n  read them, then: node test/fix.js --apply" + O + "\n");
  process.exit(0);
}

// --- merge into examples.js ------------------------------------------------
let source = fs.readFileSync(EXAMPLES_FILE, "utf8");
let added = 0;

for (const lang of ["ko", "ja", "fr", "en"]) {
  const mine = candidates.filter((c) => c.lang === lang);
  if (mine.length === 0) continue;

  const existing = new Set((EXAMPLES[lang] ?? []).map(([user]) => user.toLowerCase()));
  const fresh = mine.filter((c) => !existing.has(c.user.toLowerCase()));
  if (fresh.length === 0) continue;

  // append just before the closing bracket of that language's array
  const marker = new RegExp("(\\n  " + lang + ": \\[[\\s\\S]*?)(\\n  \\],)");
  if (!marker.test(source)) {
    console.log(R + "  could not find the " + lang + " array, skipped" + O);
    continue;
  }
  const lines = fresh
    .map((c) => '    ["' + c.user.replace(/"/g, '\\"') + '", "' + c.assistant.replace(/"/g, '\\"') + '"],')
    .join("\n");
  source = source.replace(marker, "$1\n" + lines + "$2");
  added += fresh.length;
}

fs.writeFileSync(EXAMPLES_FILE, source);
console.log(G + "\n  added " + added + " examples to src/examples.js" + O);
console.log(Y + "  now: node test/sweep.js --fresh" + O + D + "  to confirm they took\n" + O);
