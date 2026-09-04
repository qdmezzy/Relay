

const SOURCE_LAUGHTER =
  /(\b(?:lol|lmao+|lmfao+|rofl|ha(?:ha)+h?|he(?:he)+|xd|kek|jaja+)\b)|[😂🤣😹😆😹]|ㅋㅋ|ｗｗ|www/iu;

const STRONG_LAUGHTER = /\b(?:lmao+|lmfao+|rofl|kek)\b|🤣/iu;

const TRAILING_W = /([^\s])[wWｗＷ]{1,12}[\s]*$/gm;

const TRAILING_KANJI_LAUGH = /([^\s])(?:笑|草|大草原|草生える|ｗ)+[\s]*$/gm;

const JAPANESE_CHAR = /[ぁ-んァ-ヴーｰ一-龯々〜ー。、！？!?…]/;

export function normaliseJapaneseLaughter(text, source) {
  const allowed = SOURCE_LAUGHTER.test(source);
  const marker = STRONG_LAUGHTER.test(source) ? "草" : "笑";

  // end of the line only. japanese laughter sits at the end, and matching
  // anywhere ate "LoL" the game out of "LoL やろう" and left " やろう"
  let out = text.replace(
    /(^|[^\w])(lol|lmao+|lmfao+|rofl|kek)\s*$/gimu,
    (match, before) => (allowed ? before + marker : before.trimEnd())
  );

  out = out.replace(TRAILING_W, (match, prev) => {

    if (!JAPANESE_CHAR.test(prev)) return match;
    return allowed ? prev + marker : prev;
  });

  if (!allowed) {
    out = out.replace(TRAILING_KANJI_LAUGH, (match, prev) =>
      JAPANESE_CHAR.test(prev) ? prev : match
    );
  }

  return out.trimEnd();
}

const EMOJI =
  /\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*/gu;

export function stripInventedEmoji(text, source) {
  const allowed = new Set(source.match(EMOJI) ?? []);
  if (!EMOJI.test(text)) return text;

  const out = text.replace(EMOJI, (e) => (allowed.has(e) ? e : ""));

  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n");
}

export function checkScript(text, target) {
  const body = text.replace(/⟦\d+⟧/g, "").trim();
  if (!body) return null;

  if (target === "ko") {

    if (/[一-鿿]/.test(body)) return "Chinese/Hanja characters in Korean output";
    if (!/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(body)) return "no Hangul in Korean output";
  }

  if (target === "ja") {
    if (/[가-힣]/.test(body)) return "Hangul in Japanese output";

    const stripped = body.replace(/[^\p{L}]/gu, "");
    if (stripped.length > 6 && !/[぀-ゟ゠-ヿ]/.test(body))
      return "no kana in Japanese output";
  }

  if (target === "fr") {
    if (/[가-힣぀-ゟ゠-ヿ一-鿿]/.test(body)) return "CJK characters in French output";
  }

  if (target === "en") {
    if (/[가-힣぀-ゟ゠-ヿ一-鿿]/.test(body)) return "untranslated CJK in English output";
  }

  return null;
}

function isQuestion(source) {
  const s = source.trim();
  if (/[?？]/.test(s)) return true;

  const opener = s.toLowerCase().replace(/^(hey|yo|so|wait|ok|okay|um)[\s,]+/, "");

  // "lets play x" is an invitation, and korean/japanese/french all render those
  // as a question (할래? / やる？ / on joue ?). neither answer is wrong, so it
  // is not checked either way
  if (/^(lets|let's|shall we)\b/.test(opener)) return null;

  if (/^(dont|don't|do not|never|please|just|let me)\b/.test(opener)) return false;

  if (
    /^(who|what|whats|when|where|wheres|why|how|hows|which|can|could|would|will|do|does|did|is|are|am|was|were|have|has|any|anyone|wanna|should|shall)\b/.test(
      opener
    )
  )
    return true;

  if (/^(you|u)\s+(free|good|ok|okay|there|coming|down|up)\b/.test(opener)) return true;

  if (/^(i|im|i'm|ive|we|my|he|she|they|its|it's|that|this|there)\b/.test(opener)) return false;

  return null;
}

// korean and japanese chat mostly can't be bothered with a question mark. "너 뭐해"
// and "どこにいる" are obviously questions, so count an actual question word as
// asking too. yes/no questions have no such word and do still need the mark.
const QUESTION_WORDS =
  /뭐|무슨|무엇|어디|누구|누가|언제|왜|어떻게|어때|어떤|몇|얼마|何|なに|なん|どこ|どれ|だれ|誰|いつ|なんで|どうして|どうやって|いくら|いくつ|qu'est|quoi|où|quand|pourquoi|comment|combien|quel/i;

export function checkSpeechAct(text, source) {
  const asked = isQuestion(source);
  if (asked === null) return null;

  const marked = /[?？]/.test(text);

  // going the other way a question word means nothing - "왜인지 모르겠어" is a
  // statement with 왜 in it - so that direction still wants a real question mark
  if (asked && !marked && !QUESTION_WORDS.test(text)) {
    return "a question came back as a statement";
  }

  if (!asked && marked) return "a statement came back as a question";

  return null;
}

const SOURCE_NEGATION = {
  fr: /\b(pas|jamais|rien|personne|aucun|aucune)\b/i,
  ko: /(안\s|못\s|없|아니|지\s*않|지\s*못)/,
  ja: /(ない|なかった|ません|ないで|なくて|わかんない|じゃない)/,
  en: /\b(not|no|never|dont|don't|cant|can't|wont|won't|nothing|nobody|none|isnt|arent|didnt|doesnt|havent|hasnt|cannot|nah|nope)\b/i,
};

const ENGLISH_NEGATION =
  /\b(not|no|never|dont|don'?t|doesn'?t|didn'?t|cant|can'?t|won'?t|wouldn'?t|isn'?t|aren'?t|wasn'?t|haven'?t|hasn'?t|cannot|none|nothing|nobody|no one|idk|dunno|nah|nope|hardly|barely|without|un)\b/i;

export function checkNegation(text, source, sourceLang, target) {

  if (target !== "en") return null;
  const marker = SOURCE_NEGATION[sourceLang];
  if (!marker || !marker.test(source)) return null;
  return ENGLISH_NEGATION.test(text) ? null : "LOST THE NEGATION - meaning inverted";
}

export function sanitize(text, { target, source }) {
  let out = text;
  if (target === "ja") out = normaliseJapaneseLaughter(out, source);

  out = stripInventedEmoji(out, source);
  return out;
}
