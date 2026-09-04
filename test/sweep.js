// runs the whole corpus through and records everything that comes back wrong.
//
//   node test/sweep.js                 all 6000+ messages, all three languages
//   node test/sweep.js --limit=300     quick sample
//   node test/sweep.js --lang=ko       one language
//   node test/sweep.js --fresh         ignore saved progress and start over
//
// ~18k translations at roughly half a second each, so a full run is a couple of
// hours. it saves after every batch and picks up where it stopped, so ctrl-c is
// safe and you can run it in chunks.
//
// output lands in test/.sweep.json for test/fix.js to work from.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { translate } from "../src/translate.js";
import { runChecks } from "./checks.js";
import { buildCorpus, LANGS } from "./corpus.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(HERE, ".sweep.json");
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", O = "\x1b[0m";

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith("--" + n + "="));
  return hit ? hit.split("=")[1] : d;
};
const limit = Number(flag("limit", 0));
const langs = flag("lang", "") ? [flag("lang", "")] : LANGS;
const fresh = args.includes("--fresh");

let corpus = buildCorpus();
if (limit) corpus = corpus.slice(0, limit);

const jobs = [];
for (const lang of langs) for (const entry of corpus) jobs.push({ lang, ...entry });

let done = {};
let failures = [];
if (!fresh && fs.existsSync(STATE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE, "utf8"));
    done = saved.done ?? {};
    failures = saved.failures ?? [];
  } catch {}
}

const key = (job) => job.lang + "\u0000" + job.text;
const save = () =>
  fs.writeFileSync(STATE, JSON.stringify({ done, failures, at: new Date().toISOString() }));

const todo = jobs.filter((job) => !done[key(job)]);
console.log(
  "\n  " + corpus.length + " messages x " + langs.length + " languages = " + jobs.length + " translations"
);
if (todo.length < jobs.length) {
  console.log(D + "  resuming, " + (jobs.length - todo.length) + " already done" + O);
}
console.log("");

const started = Date.now();
let processed = 0;
let broke = 0;
let backendErrors = 0;

for (const job of todo) {
  try {
    const result = await translate({ text: job.text, target: job.lang });
    const problems = runChecks(result.text, { source: job.text, target: job.lang });
    done[key(job)] = problems.length ? 1 : 0;
    if (problems.length) {
      broke++;
      failures.push({ lang: job.lang, tag: job.tag, input: job.text, out: result.text, problems });
    }
    backendErrors = 0;
  } catch (error) {
    // a dead backend is not a translation failure. the first full run recorded
    // 13,896 "failures" that were all just ollama having stopped, which buried
    // the ~550 real ones
    backendErrors++;
    if (backendErrors >= 5) {
      save();
      console.log(
        "\n\n" + R + "  backend stopped answering after " + processed + " translations" + O +
          "\n  " + error.message.split("\n")[0] +
          "\n" + D + "  progress is saved. start it back up and run again to carry on." + O + "\n"
      );
      process.exit(1);
    }
    continue;
  }

  processed++;
  if (processed % 25 === 0) {
    const rate = processed / ((Date.now() - started) / 1000);
    const left = Math.round((todo.length - processed) / Math.max(rate, 0.01));
    process.stdout.write(
      "\r" + D + "  " + processed + "/" + todo.length +
        "   " + broke + " broken   " + rate.toFixed(1) + "/s   ~" +
        Math.floor(left / 60) + "m left        " + O
    );
    save();
  }
}
save();
process.stdout.write("\r" + " ".repeat(78) + "\r");

// --- report ---------------------------------------------------------------
const total = Object.keys(done).length;
const badTotal = Object.values(done).filter(Boolean).length;
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

const byProblem = {};
for (const f of failures) {
  for (const p of f.problems) {
    const bucket = p.replace(/\d+/g, "N").replace(/ .*x$/, "");
    (byProblem[bucket] ??= []).push(f);
  }
}

console.log("=".repeat(70));
console.log(
  (badTotal ? R : G) + "  " + badTotal + " broken of " + total + "  (" + pct(badTotal, total) + "%)" + O
);
console.log("=".repeat(70));

console.log("\n  what broke");
for (const [problem, list] of Object.entries(byProblem).sort((a, b) => b[1].length - a[1].length)) {
  console.log("    " + String(list.length).padStart(5) + "  " + problem);
  for (const sample of list.slice(0, 2)) {
    console.log(D + "           " + sample.lang + "  " + JSON.stringify(sample.input) + O);
    console.log(D + "           -> " + sample.out + O);
  }
}

const byLang = {};
const byTag = {};
for (const f of failures) {
  byLang[f.lang] = (byLang[f.lang] ?? 0) + 1;
  byTag[f.tag] = (byTag[f.tag] ?? 0) + 1;
}

console.log("\n  by language");
for (const lang of langs) {
  const n = jobs.filter((j) => j.lang === lang).length;
  const b = byLang[lang] ?? 0;
  console.log("    " + lang + "   " + String(b).padStart(5) + " / " + n + "  (" + pct(b, n) + "%)");
}

console.log("\n  by topic");
for (const [tag, n] of Object.entries(byTag).sort((a, b) => b[1] - a[1])) {
  console.log("    " + tag.padEnd(11) + String(n).padStart(5));
}

console.log(
  D + "\n  " + ((Date.now() - started) / 60000).toFixed(1) + " min.  " +
    failures.length + " failures saved to test/.sweep.json" + O
);
console.log(Y + "  next: node test/fix.js" + O + D + "  (writes corrections using a stronger model)" + O + "\n");
