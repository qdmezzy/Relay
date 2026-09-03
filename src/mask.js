

const PATTERNS = [

  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /https?:\/\/\S+/g,
  /<a?:\w+:\d+>/g,
  /<@[!&]?\d+>/g,
  /<#\d+>/g,
  /<t:\d+(?::[tTdDfFR])?>/g,
  /@(?:everyone|here)\b/g,
  /:[a-z0-9_+-]+:/gi,
  /\|\|[\s\S]*?\|\|/g,

  /\p{Extended_Pictographic}\p{Emoji_Modifier}?(?:️)?(?:‍\p{Extended_Pictographic}\p{Emoji_Modifier}?(?:️)?)*/gu,
];

const PLACEHOLDER = /⟦(\d+)⟧/g;
const SLOPPY_PLACEHOLDER = /⟦\s*([0-9０-９]+)\s*⟧/g;
const SUBSTITUTED_BRACKETS = /[[〔【]\s*(\d+)\s*[\]〕】]/g;
const FULLWIDTH_DIGIT = /[０-９]/g;

const ph = (n) => "⟦" + n + "⟧";

export function mask(text) {
  const found = [];
  let masked = text;

  for (const pattern of PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      found.push(match);
      return ph(found.length - 1);
    });
  }

  if (found.length === 0) return { masked, tokens: [] };

  const tokens = [];
  masked = masked.replace(PLACEHOLDER, (_, i) => {
    tokens.push(found[Number(i)]);
    return ph(tokens.length - 1);
  });

  return { masked, tokens };
}

export function unmask(text, tokens) {
  if (tokens.length === 0) return text;

  let out = text;

  out = out.replace(SLOPPY_PLACEHOLDER, (_, digits) =>
    ph(
      digits.replace(FULLWIDTH_DIGIT, (d) =>
        String.fromCharCode(d.charCodeAt(0) - 0xfee0)
      )
    )
  );

  out = out.replace(SUBSTITUTED_BRACKETS, (_, n) => ph(n));

  out = out.replace(PLACEHOLDER, (match, index) => {
    const token = tokens[Number(index)];
    return token === undefined ? match : token;
  });

  return out;
}

export function verify(text, tokens) {
  return tokens.filter((t) => !text.includes(t));
}
