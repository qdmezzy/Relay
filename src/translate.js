import { loadConfig, resolveProfile } from "./config.js";
import { createProvider } from "./providers/index.js";
import { buildOutgoingSystem, buildIncomingSystem } from "./prompt.js";
import { EXAMPLES } from "./examples.js";
import { mask, unmask, verify } from "./mask.js";
import { sanitize, checkScript, checkSpeechAct, checkNegation } from "./sanitize.js";
import { detectLanguage, looksEnglish } from "./detect.js";
import { recall } from "./memory.js";

// every example goes in, in the same order every time, and that matters more
// than it looks: a stable prefix is cacheable, and a cached token costs a tenth
// of a fresh one. i tried trimming this to the ~26 closest matches - it cut the
// prompt 19% and cost 3x more, because varying the examples means they can
// never be cached. anything that changes per message goes after this block.
function buildShots(target, text) {
  const pairs = [...(EXAMPLES[target] ?? [])];
  const stable = pairs.length * 2;

  // corrections i've saved go last, nearest the real message, where they pull
  // the most weight - and after the cache boundary, since they do change
  const remembered = recall(target, text);
  for (const hit of [...remembered].reverse()) pairs.push([hit.source, hit.translation]);

  const shots = pairs.flatMap(([user, assistant]) => [
    { role: "user", content: user },
    { role: "assistant", content: assistant },
  ]);
  return { shots, stable };
}

const providerCache = new Map();

async function getProvider(config) {
  const key = config.provider + ":" + JSON.stringify(config.providers?.[config.provider] ?? {});
  if (!providerCache.has(key)) providerCache.set(key, await createProvider(config));
  return providerCache.get(key);
}

export async function translate({ text, target, profile: profileName, signal, hint }) {
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

  // second pass. the check already worked out exactly what went wrong - "dropped
  // play", "added girlfriend" - so hand that back instead of just rolling the
  // dice on another sample and hoping.
  if (hint) {
    system +=
      "\n\nYour last attempt was wrong: " + hint +
      "\nTranslate the whole message. Do not drop any part of it and do not add anything that is not there.";
  }

  const started = Date.now();
  const { shots, stable } = buildShots(target, masked);

  const ask = (temperature) =>
    provider.translate({ system, user: masked, shots, stable, signal, model: profile.model, temperature });

  // a repair pass has to come back with something different. at the normal
  // temperature the model just re-samples the same answer it already gave and
  // the retry is wasted.
  let result = await ask(hint ? 0.8 : undefined);

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

  let missing = verify(out, tokens);

  // masking stops the model mangling an emoji but cannot make it reproduce the
  // placeholder. it swapped ⟦0⟧ for ㅠㅠ on its own in ~390 messages of a sweep.
  // emoji belong at the end of a chat message anyway, so putting a dropped one
  // back there is safe and makes preservation an actual guarantee
  const droppedEmoji = missing.filter((t) => /^\p{Extended_Pictographic}/u.test(t));
  if (droppedEmoji.length > 0) {
    out = out.trimEnd() + " " + droppedEmoji.join("");
    missing = verify(out, tokens);
  }

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

  // with thinking turned off the model very occasionally leaks a stray tag into
  // the visible answer. cheap to strip, and a tag in a discord message is worse
  // than any amount of defensive code
  out = out.replace(/<\/?(?:thinking|think|reasoning)>/gi, "").trim();

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
