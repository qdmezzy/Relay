// things that are wrong about a translation without needing to know what it was
// supposed to mean. no second model call, so these are cheap enough to run on
// every message in the sweep.

import { checkScript, checkSpeechAct, checkNegation } from "../src/sanitize.js";

const EMOJI =
  /\p{Extended_Pictographic}\p{Emoji_Modifier}?(?:️)?(?:‍\p{Extended_Pictographic}\p{Emoji_Modifier}?(?:️)?)*/gu;

export function koBanmal(out) {
  if (/(습니다|ㅂ니다|십시오|하십)/.test(out)) return "formal 합쇼체 in 반말 mode";
  if (/요\s*[.!?~]*\s*(\n|$)/.test(out) || /요[,!?]/.test(out)) return "polite 해요체 in 반말 mode";
  return null;
}

export function jaPlain(out) {
  if (/(です|ます|でした|ました|ません|ございま)/.test(out)) return "です・ます in plain mode";
  if (/[ぁ-んァ-ヴ一-龯][wW]{1,6}\s*$/.test(out) || /\s[wW]{2,6}\s*$/.test(out))
    return "romaji w instead of 笑 / 草";
  return null;
}

export function frFamilier(out, source) {
  const plural = /\b(you guys|yall|y'all|you all|everyone|guys|who else|we|us)\b/i.test(source ?? "");
  if (!plural && /\bvous\b/i.test(out)) return "vous in tutoiement mode";
  if (/\bne\s+[\w']+\s+(pas|plus|jamais|rien)\b/i.test(out)) return "kept the 'ne' in negation";
  return null;
}

const REGISTER = { ko: koBanmal, ja: jaPlain, fr: frFamilier };

export function emojiPreserved(out, source) {
  const want = source.match(EMOJI) ?? [];
  if (want.length === 0) {
    const extra = out.match(EMOJI) ?? [];
    return extra.length ? "invented " + extra.length + " emoji" : null;
  }
  const missing = want.filter((e) => !out.includes(e));
  return missing.length ? "dropped emoji " + missing.join("") : null;
}

export function noFraming(out) {
  if (/\((?:translation|note|lit\.|literally)[:\s]/i.test(out)) return "added a translation note";
  if (/^(here'?s|the translation|translated)/i.test(out.trim())) return "added a preamble";
  if (/\n\s*\n/.test(out.trim())) return "invented extra paragraphs";
  return null;
}

export function lengthSane(out, source) {
  if (source.length < 20 || out.length < 20) {
    return out.length > source.length + 60
      ? "expanded a short message by " + (out.length - source.length) + " chars"
      : null;
  }
  const cjk = (source.match(/[가-힣ぁ-んァ-ヴ一-龯]/g) || []).length;
  const dense = cjk / Math.max(source.length, 1) > 0.3;
  const ratio = out.length / Math.max(source.length, 1);
  if (ratio > (dense ? 4 : 2.5)) return "padded " + ratio.toFixed(1) + "x";
  if (ratio < 0.25) return "truncated to " + ratio.toFixed(2) + "x";
  return null;
}

// the message came back in english, ie the model did nothing. for korean and
// japanese checkScript already catches it; this is the latin-script case
export function notPassedThrough(out, source, target) {
  if (target !== "fr") return null;
  const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (normalise(out) === normalise(source)) return "came back unchanged";
  const english = /\b(wanna|gonna|dont|cant|didnt|isnt|arent|youre|theyre|im|ive|lets|yeah|nah|guys|bro|dude|the|and|with|about|because|really|something|anything|nothing|everyone|anyone)\b/gi;
  const hits = (out.match(english) || []).length;
  return hits >= 2 ? "still english (" + hits + " english words)" : null;
}

// discord syntax has to survive byte for byte
export function syntaxIntact(out, source) {
  const tokens = source.match(/<@!?\d+>|https?:\/\/\S+|:[a-z0-9_+-]+:|\|\|[\s\S]*?\|\||`[^`\n]+`/gi) ?? [];
  const missing = tokens.filter((t) => !out.includes(t));
  return missing.length ? "dropped " + missing.join(" ") : null;
}

/**
 * @returns {string[]} problems found, empty when clean
 */
export function runChecks(out, { source, target, sourceLang = "en" }) {
  return [
    checkScript(out, target),
    checkSpeechAct(out, source),
    checkNegation(out, source, sourceLang, target),
    REGISTER[target]?.(out, source),
    emojiPreserved(out, source),
    noFraming(out),
    lengthSane(out, source),
    notPassedThrough(out, source, target),
    syntaxIntact(out, source),
  ].filter(Boolean);
}
