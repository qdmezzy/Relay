import { loadConfig, resolveProfile } from "./config.js";
import { createProvider } from "./providers/index.js";
import { buildOutgoingSystem, buildIncomingSystem } from "./prompt.js";
import { EXAMPLES } from "./examples.js";
import { mask, unmask, verify } from "./mask.js";
import { sanitize, checkScript, checkSpeechAct, checkNegation } from "./sanitize.js";
import { detectLanguage, looksEnglish } from "./detect.js";

function buildShots(target) {
  return (EXAMPLES[target] ?? []).flatMap(([user, assistant]) => [
    { role: "user", content: user },
    { role: "assistant", content: assistant },
  ]);
}

const providerCache = new Map();

async function getProvider(config) {
  const key = config.provider + ":" + JSON.stringify(config.providers?.[config.provider] ?? {});
  if (!providerCache.has(key)) providerCache.set(key, await createProvider(config));
  return providerCache.get(key);
}

export async function translate({ text, target, profile: profileName, signal }) {
  const source = text ?? "";
  if (!source.trim()) {
    return { text: "", skipped: "empty", warnings: [] };
  }

  const config = loadConfig();
  const provider = await getProvider(config);
  const warnings = [];

  const { masked, tokens } = mask(source);

  if (!masked.replace(/⟦\d+⟧/g, "").trim()) {
    return { text: source, skipped: "nothing-to-translate", warnings };
  }

  const detected = detectLanguage(source);
  const skip = detected === target && (target !== "en" || looksEnglish(source));
  if (skip) {
    return { text: source, skipped: "already-" + target, warnings };
  }

  let system;
  let profile;
  if (target === "en") {

    profile = detected ? resolveProfile(config, detected, profileName) : {};
    system = buildIncomingSystem({ source: detected, you: config.you });
  } else {
    profile = resolveProfile(config, target, profileName);
    system = buildOutgoingSystem({
      target,
      register: profile.register,
      you: config.you,
      profile,
    });
  }

  const started = Date.now();
  const shots = buildShots(target);

  const ask = (temperature) =>
    provider.translate({ system, user: masked, shots, signal, model: profile.model, temperature });

  let result = await ask();

  const validate = (text) => {
    const t = cleanup(text);
    return (
      checkScript(t, target) ??
      checkSpeechAct(t, source) ??
      checkNegation(t, source, detected, target)
    );
  };

  const problem = validate(result.text);
  if (problem) {

    let fixed = false;
    for (const temperature of [0.8, 1.0]) {
      const retry = await ask(temperature);
      if (!validate(retry.text)) {
        result = retry;
        fixed = true;
        break;
      }
    }
    if (!fixed) warnings.push(problem + " (retried twice)");
  }

  const ms = Date.now() - started;

  let out = cleanup(result.text);

  out = sanitize(out, { target, source });
  out = unmask(out, tokens);

  const missing = verify(out, tokens);
  if (missing.length > 0) {
    warnings.push(
      "dropped " + missing.length + " protected token(s): " + missing.join(" ")
    );
  }

  if (!out.trim()) {
    throw new Error("The model returned an empty translation.");
  }

  return { text: out, ms, usage: result.usage, provider: provider.name, warnings };
}

function cleanup(text) {
  let out = (text ?? "").trim();

  out = out.replace(
    /^(?:korean|japanese|french|english|translation|translated|output|번역|翻訳|traduction)\s*[:：]\s*/i,
    ""
  );

  const pairs = [
    ['"', '"'],
    ["'", "'"],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u00ab", "\u00bb"],
  ];
  for (const [open, close] of pairs) {
    if (out.length > 1 && out.startsWith(open) && out.endsWith(close)) {
      const inner = out.slice(open.length, -close.length);
      if (!inner.includes(open) && !inner.includes(close)) {
        out = inner.trim();
        break;
      }
    }
  }

  const fenced = out.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fenced) out = fenced[1].trim();

  return out;
}
