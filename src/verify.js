// translates the translation back to english and checks it still says what i said.
//
// this is the only way to catch the bad ones. a translation that comes out
// confidently wrong looks completely fine if you can't read the language - the
// model isn't unsure, it just made something up. going back to english is the
// one check that doesn't need me to know korean.

import { loadConfig } from "./config.js";
import { createProvider } from "./providers/index.js";
import { mask } from "./mask.js";

// deliberately NOT the normal english path. that one is built to read naturally
// in my voice, so it paraphrases - it turned "나 화 안 났어" into "i dont care"
// and made a correct translation look broken. for checking i want a flat literal
// gloss, no personality, no tidying up.
const SOURCE_NAME = { ko: "Korean", ja: "Japanese", fr: "French", en: "English" };

const literalPrompt = (from) => [
  "Translate this " + (SOURCE_NAME[from] || "") + " message into English, literally.",
  "Keep every detail exactly: numbers, times, names, and any negative.",
  "Do not paraphrase, do not make it sound natural, do not add or remove anything.",
  "Chat slang you will see:",
  "  Korean - 마크 minecraft, 롤 league, 옵치 overwatch, 발로 valorant, 통화 call/vc,",
  "    ㅋㅋ laughing, ㅠㅠ crying, 개- very, 헐 whoa, 뭐해 what are you doing",
  "  Japanese - マイクラ minecraft, 通話 call/vc, 笑 and 草 laughing, まじ really,",
  "    やばい crazy, タメ口 casual speech",
  "  French - mdr and ptdr laughing, wesh/frere mate",
  "Reply with the English and nothing else.",
].join("\n");

let cached = null;
async function provider() {
  const config = loadConfig();
  const key = config.provider + ":" + JSON.stringify(config.providers?.[config.provider] ?? {});
  if (!cached || cached.key !== key) {
    cached = { key, instance: await createProvider(config) };
  }
  return cached.instance;
}

const STOP = new Set([
  "a", "an", "the", "is", "am", "are", "was", "were", "be", "been", "being",
  "to", "of", "and", "or", "but", "in", "on", "at", "for", "with", "it", "its",
  "this", "that", "there", "here", "i", "im", "ive", "you", "your", "youre",
  "u", "me", "my", "we", "our", "he", "she", "they", "them", "his", "her",
  "do", "did", "does", "so", "just", "like", "yeah", "yo", "hey", "bro", "ok",
  "okay", "lol", "lmao", "gonna", "wanna", "up", "out", "if", "then", "than",
  "as", "about", "some", "any", "all", "will", "till", "until", "really",
  "very", "much", "been", "have", "has",
  // openers and fillers. "one" and "nobody" are in here so that "no one came"
  // and "nobody came" stop looking like different sentences - the negation
  // check is what actually guards that one.
  "nah", "no", "yeah", "yep", "nope", "well", "one", "nobody",
  // laughter and intensifiers. the gloss writes 笑 out as "haha" and adds
  // "seriously" for まじ, and neither is a change in what i said.
  "haha", "hehe", "hah", "lmaooo", "seriously", "man", "dude", "damn",
]);

// "nah" is not in here on purpose. it opens half my messages and it is a filler
// word, not a real negative - counting it flagged "nah bro i died 40 times".
const NEGATION = /\b(not|no|never|none|nothing|nobody|cant|cannot|dont|doesnt|didnt|wont|wouldnt|isnt|arent|aint|neither|nor)\b/gi;

const NUMBER_WORDS = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", twenty: "20",
  thirty: "30", forty: "40", fifty: "50", hundred: "100",
};

function words(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// words that mean the same thing to me but not to a bag of words. without this
// "are you still in the call" coming back as "still in the vc" reads as a
// meaning change, which it obviously isn't. add to it when a false alarm shows up.
const SAME = new Map([
  ["vc", "call"], ["voicechat", "call"], ["voice", "call"],
  ["mc", "minecraft"], ["val", "valorant"], ["league", "lol"], ["comp", "ranked"],
  ["sleepy", "tired"], ["exhausted", "tired"], ["knackered", "tired"],
  ["bed", "sleep"], ["asleep", "sleep"], ["sleeping", "sleep"],
  ["pissed", "angry"], ["mad", "angry"], ["annoyed", "angry"],
  ["battle", "fight"], ["crazy", "insane"], ["wild", "insane"], ["nuts", "insane"],
  ["mins", "minutes"], ["min", "minutes"], ["hrs", "hours"], ["hr", "hours"],
  ["currently", "now"], ["presently", "now"], ["atm", "now"], ["moment", "now"],
  ["working", "work"], ["works", "work"], ["broken", "break"],
]);

function content(text) {
  return new Set(
    words(text)
      .filter((w) => !STOP.has(w) && w.length > 1)
      .map((w) => SAME.get(w) ?? w)
  );
}

function numbers(text) {
  const found = new Set();
  for (const w of words(text)) {
    if (/^\d+$/.test(w)) found.add(w);
    else if (NUMBER_WORDS[w]) found.add(NUMBER_WORDS[w]);
  }
  return found;
}

// "nah bro i died 40 times" glosses back as "No, brother, I died 40 times" and
// that leading no is just how i open a sentence, not a negative. drop it off the
// front first. "no" with a comma after it only - "no one came" has to survive.
const OPENER = /^\s*(?:nah|yeah|yep|nope|well|ok|okay|yo|bro)\b[,\s]+|^\s*(?:no|yes)\s*,\s*/i;

function negated(text) {
  return (String(text).replace(OPENER, "").match(NEGATION) || []).length > 0;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// how much of what i said actually survived the round trip. dropping a word is
// a much stronger signal than gaining one, because the model likes to reword
// things with synonyms and that's fine.
export function meaningDrift(original, roundTrip) {
  const mine = content(original);
  const back = content(roundTrip);
  const reasons = [];

  if (!mine.size) return { verdict: "ok", kept: 1, reasons };

  const near = (word, set) =>
    set.has(word) || [...set].some((other) => other.startsWith(word) || word.startsWith(other));

  const lost = [...mine].filter((w) => !near(w, back));
  const invented = [...back].filter((w) => !near(w, mine));
  const ratio = (mine.size - lost.length) / mine.size;
  // words that appeared out of nowhere matter as much as words that vanished.
  // "ive had her for two weeks" coming back as "ive been dating her" loses
  // almost nothing - the whole problem is the word it made up.
  const clean = back.size ? (back.size - invented.length) / back.size : 1;

  if (negated(original) !== negated(roundTrip)) {
    reasons.push(negated(original) ? "the 'not' went missing" : "it added a 'not'");
  }
  if (!sameSet(numbers(original), numbers(roundTrip))) {
    reasons.push("the numbers changed");
  }
  if (lost.length) reasons.push("dropped " + lost.slice(0, 3).join(", "));
  if (invented.length) reasons.push("added " + invented.slice(0, 3).join(", "));

  // deliberately hard to set off. word overlap can't tell a paraphrase from a
  // hallucination - "i cant come" -> "i cant make it" looks exactly like
  // "ive had her" -> "ive been dating her". so only shout when it's obvious,
  // and show the english back to me either way so i can just read it myself.
  // a warning that goes off on every second message is a warning i'd ignore.
  // "is this working now man" only has two words worth counting, so one synonym
  // swap already reads as 50% wrong. on a message that short the ratio is too
  // coarse to shout about - unless nothing at all survived, which is real.
  const short = mine.size < 3;

  let verdict = "ok";
  if (reasons.some((r) => r.includes("'not'") || r.includes("numbers"))) verdict = "bad";
  else if (ratio === 0) verdict = "bad";
  else if (short) verdict = ratio < 1 || clean < 0.5 ? "check" : "ok";
  else if (ratio <= 0.5 || clean <= 0.5) verdict = "bad";
  else if (ratio < 0.6 || clean < 0.6) verdict = "check";

  return { verdict, kept: Number(ratio.toFixed(2)), clean: Number(clean.toFixed(2)), reasons };
}

const RANK = { ok: 0, check: 1, bad: 2 };

// knowing the translation is wrong and just saying so is useless. take what the
// check worked out, hand it back to the model, and check the second attempt the
// same way. only keep it if it actually came out better - a retry that's just
// differently wrong is worse than leaving it alone.
export async function repairTranslation({ text, translation, target, drift, signal }) {
  const { translate } = await import("./translate.js");
  // "dropped play" means nothing to the model as an instruction. spell out what
  // it has to do differently.
  const hint = drift.reasons
    .map((reason) => {
      if (reason.startsWith("dropped ")) {
        return "you left out " + reason.slice(8) + " - that has to be in there";
      }
      if (reason.startsWith("added ")) {
        return "you invented " + reason.slice(6) + " - none of that is in the message";
      }
      if (reason.includes("'not'")) return "the message is a negative, keep it negative";
      if (reason.includes("numbers")) return "keep the numbers exactly as they are";
      return reason;
    })
    .join("; ");
  let attempt;
  try {
    attempt = await translate({ text, target, signal, hint });
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
  const fixed = (attempt?.text || "").trim();
  if (!fixed || fixed === translation) return null;

  const checked = await verifyMeaning({ text, translation: fixed, target, signal, repair: false });
  if (checked.unavailable) return null;
  if (RANK[checked.verdict] >= RANK[drift.verdict]) return null;

  return { text: fixed, meaning: checked.meaning, verdict: checked.verdict, summary: checked.summary };
}

export async function verifyMeaning({ text, translation, target, signal, repair = false }) {
  if (!text?.trim() || !translation?.trim()) {
    return { meaning: "", verdict: "ok", kept: 1, reasons: [] };
  }
  const engine = await provider();
  // strip the emoji and discord syntax out of both sides first, otherwise the
  // gloss tries to describe them and they count as words that went missing
  const { masked } = mask(translation);
  let meaning = "";
  try {
    const back = await engine.translate({
      system: literalPrompt(target),
      user: masked,
      shots: [],
      signal,
      temperature: 0,
    });
    meaning = (back.text || "").replace(/⟦\d+⟧/g, "").replace(/\s+/g, " ").trim();
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error("[verify] could not read it back:", error.message.split("\n")[0]);
    return { meaning: "", verdict: "ok", kept: 1, reasons: [], unavailable: true };
  }
  // sometimes the gloss just hands the message straight back untranslated. that
  // is a failed check, not a meaning change - saying "check this: マジ何？" would
  // be a warning about nothing.
  const stillForeign = /[぀-ヿ一-鿿가-힯]/.test(meaning);
  if (!meaning || stillForeign || !/[a-z]/i.test(meaning)) {
    console.error("[verify] could not read the draft back, skipping the check");
    return { meaning: "", verdict: "ok", kept: 1, reasons: [], unavailable: true };
  }
  const drift = meaningDrift(mask(text).masked, meaning);
  // the helper has no json parser, so hand it one ready made line
  const answer = { meaning, ...drift, summary: drift.reasons.join(", "), target };

  // only worth asking a model that can actually act on the feedback. measured
  // this on the local 4b: 9 repair attempts across 3 messages, 0 came back
  // better, and most came back character for character identical. it isn't
  // being careless - that answer is the best it has, so telling it "you left
  // out play" buys nothing except a wasted round trip on every warning.
  const canRepair = loadConfig().provider === "anthropic";
  if (repair && canRepair && drift.verdict !== "ok") {
    const better = await repairTranslation({ text, translation, target, drift, signal });
    if (better) answer.fixed = better;
  }
  return answer;
}
