

const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/g;
const KANA = /[぀-ゟ゠-ヿ]/g;
const HAN = /[一-鿿]/g;

const FRENCH_WORDS =
  /\b(je|tu|il|elle|on|nous|vous|ils|elles|est|es|suis|sont|etes|était|sera|ai|as|avez|avons|ont|pas|plus|jamais|rien|personne|ne|mais|avec|pour|dans|sur|sous|chez|vers|que|qui|quoi|quand|comment|pourquoi|combien|où|ou|donc|alors|aussi|encore|toujours|déjà|bien|tout|tous|toute|très|trop|peu|beaucoup|ca|cest|jai|jsuis|tas|tes|ouai|wesh|frere|frerot|envoie|envoyer|marche|craint|foutu|louche|moyen|ranked|merci|bonjour|salut|coucou|oui|non|ouais|nan|mec|meuf|truc|machin|ouf|chelou|grave|genre|carrément|franchement|bref|jouer|joue|jouons|manger|mange|dormir|dors|rentrer|rentre|faire|fais|fait|dire|dis|dit|aller|va|vais|vont|venir|viens|prendre|voir|vois|savoir|sais|sait|pouvoir|peux|peut|vouloir|veux|veut|devoir|dois|doit|mon|ma|mes|ton|ta|tes|son|sa|ses|notre|votre|leur|le|la|les|un|une|des|du|au|aux|ce|cette|ces|cela|ça|celui|moi|toi|lui|eux|même|autre|chaque|quelque|plusieurs|demain|hier|aujourd|soir|matin|nuit|jour|semaine|mois|année|maintenant|ici|là|mdr|ptdr|jpp)\b/gi;

// words that are just as ordinary in english. they get no weight on their own,
// or "anyone on roblox" and "plus one" come out french
const AMBIGUOUS = /\b(on|as|plus|la|le|un|son|ton|ma|sa|ce|du|des|va|dit|fait|note|page|part|table|car|but|chat|pain|coin|main|force|image|sale|rose|second|film|long|ranked|marche|moyen|tour|four|sur|mes|ces)\b/gi;

const FRENCH_ELISION = /\b(?:j|l|d|qu|n|c|t|s|m|jusqu|lorsqu|puisqu)['’]/gi;

const FRENCH_DIACRITICS = /[àâäçéèêëîïôöùûüÿœæ]/gi;

const ENGLISH_WORDS =
  /\b(the|is|are|am|was|were|be|been|being|you|your|youre|i|im|ive|id|ill|me|my|mine|we|our|they|them|their|he|she|his|her|it|its|to|of|in|on|at|for|with|from|and|or|but|so|if|then|than|that|this|these|those|do|does|did|dont|doesnt|didnt|not|no|nope|nah|yes|yeah|yep|ok|okay|what|when|where|why|how|who|which|can|cant|could|will|wont|would|should|have|has|had|havent|hasnt|get|got|go|going|gonna|wanna|know|think|thought|want|need|like|love|hate|make|made|take|took|see|saw|say|said|tell|told|come|came|back|just|now|here|there|today|tomorrow|yesterday|night|tonight|day|time|really|very|too|also|still|already|about|because|lol|lmao|omg|bro|dude|man)\b/gi;

const count = (text, re) => (text.match(re) || []).length;

export function looksEnglish(text) {
  if (!text) return false;
  if (/[가-힯぀-ヿ一-鿿]/.test(text)) return false;
  if (count(text, FRENCH_ELISION) > 0 || count(text, FRENCH_DIACRITICS) > 0) return false;
  return count(text, ENGLISH_WORDS) >= 2;
}

export function detectLanguage(text) {
  if (!text || !text.trim()) return null;

  const hangul = count(text, HANGUL);
  const kana = count(text, KANA);
  const han = count(text, HAN);

  if (hangul >= 2 || (hangul >= 1 && text.trim().length <= 6)) return "ko";
  if (kana >= 2 || (kana >= 1 && text.trim().length <= 6)) return "ja";

  if (han >= 1) return "ja";
  if (hangul >= 1) return "ko";
  if (kana >= 1) return "ja";

  const frenchWords = count(text, FRENCH_WORDS);
  const elisions = count(text, FRENCH_ELISION);
  const diacritics = count(text, FRENCH_DIACRITICS);
  const englishWords = count(text, ENGLISH_WORDS);

  // only words french does not share with english count. an apostrophe elision
  // or an accent is worth more than a word, since english has neither
  const shared = count(text, AMBIGUOUS);
  const french = Math.max(0, frenchWords - shared) + elisions * 2 + diacritics * 2;

  if (french === 0) return "en";
  return french >= englishWords ? "fr" : "en";
}
