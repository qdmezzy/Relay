// a growing bank of translations i've checked and know are right.
//
// examples.js is the hand written core and always goes in the prompt. this is
// the part that grows: every time a translation comes back wrong and i fix it,
// the fix lands here, and next time i type something similar it gets pulled
// back out and shown to the model as an example.
//
// matching is plain token overlap, no embeddings. that isn't me being lazy -
// the eamt paper this year found token based fuzzy matching beats embedding
// retrieval for picking translation examples, and it costs no vram and no
// second model.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const STORE = process.env.RELAY_MEMORY
  ? path.resolve(process.env.RELAY_MEMORY)
  : path.join(ROOT, "memory.json");
const MAX_PER_LANG = 20000;

let bank = null;
let bankMtime = 0;

function empty() {
  return { ko: [], ja: [], fr: [], en: [] };
}

function load() {
  let stat = null;
  try {
    stat = fs.statSync(STORE);
  } catch {
    bank = bank ?? empty();
    return bank;
  }
  if (bank && stat.mtimeMs === bankMtime) return bank;

  try {
    const parsed = JSON.parse(fs.readFileSync(STORE, "utf8"));
    bank = { ...empty(), ...parsed };
  } catch {
    bank = empty();
  }
  bankMtime = stat.mtimeMs;
  return bank;
}

const STOP = new Set([
  "a", "an", "the", "is", "am", "are", "was", "were", "be", "been", "to", "of",
  "and", "or", "but", "in", "on", "at", "for", "with", "it", "its", "this",
  "that", "i", "im", "you", "your", "u", "me", "my", "we", "do", "did", "does",
]);

function tokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function trigrams(text) {
  const clean = " " + String(text).toLowerCase().replace(/\s+/g, " ").trim() + " ";
  const out = new Set();
  for (let i = 0; i < clean.length - 2; i++) out.add(clean.slice(i, i + 3));
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

// rare words tell you far more than common ones. "minecraft" matching is a real
// signal, "the" matching is noise, so weight by how rare the word is in the bank.
function idfTable(entries) {
  const seen = new Map();
  for (const entry of entries) {
    for (const token of new Set(entry.tokens)) {
      seen.set(token, (seen.get(token) ?? 0) + 1);
    }
  }
  const total = entries.length || 1;
  return (token) => Math.log(1 + total / (1 + (seen.get(token) ?? 0)));
}

function prepared(lang) {
  const entries = load()[lang] ?? [];
  return entries.map((entry) => ({
    ...entry,
    tokens: entry.tokens ?? tokens(entry.source),
    grams: entry.grams ?? trigrams(entry.source),
  }));
}

export function recall(lang, text, limit = 12, floor = 0.18) {
  return rank(prepared(lang), text, limit, floor);
}

// scores a list of pairs against what i typed. only recall uses it - i tried
// pointing the hand written examples at this too and it cost more, because
// examples that change every message can never be cached.
function rank(entries, text, limit = 12, floor = 0.18) {
  if (!entries.length || !text?.trim()) return [];
  entries = entries.map((entry) => ({
    ...entry,
    tokens: entry.tokens ?? tokens(entry.source),
    grams: entry.grams ?? trigrams(entry.source),
  }));

  const idf = idfTable(entries);
  const queryTokens = tokens(text);
  const queryGrams = trigrams(text);
  const querySet = new Set(queryTokens);

  const scored = [];
  for (const entry of entries) {
    let shared = 0;
    let queryWeight = 0;
    for (const token of querySet) {
      const weight = STOP.has(token) ? 0.15 : 1;
      queryWeight += weight * idf(token);
      if (entry.tokens.includes(token)) shared += weight * idf(token);
    }
    const overlap = queryWeight ? shared / queryWeight : 0;
    const shape = jaccard(queryGrams, entry.grams);
    const score = overlap * 0.7 + shape * 0.3;
    if (score >= floor) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ entry, score }) => ({
    source: entry.source,
    translation: entry.translation,
    score: Number(score.toFixed(3)),
  }));
}

export function remember(lang, source, translation) {
  const src = String(source ?? "").trim();
  const out = String(translation ?? "").trim();
  if (!src || !out) return { saved: false, reason: "empty" };
  if (!(lang in empty())) return { saved: false, reason: "unknown language" };

  const current = load();
  const list = current[lang];
  const match = src.toLowerCase();
  const existing = list.findIndex((entry) => entry.source.toLowerCase() === match);

  if (existing >= 0) {
    if (list[existing].translation === out) return { saved: false, reason: "already known" };
    list[existing] = { source: src, translation: out, at: Date.now() };
  } else {
    list.push({ source: src, translation: out, at: Date.now() });
    if (list.length > MAX_PER_LANG) list.splice(0, list.length - MAX_PER_LANG);
  }

  const slim = {};
  for (const key of Object.keys(current)) {
    slim[key] = current[key].map(({ source: s, translation: t, at }) => ({ source: s, translation: t, at }));
  }
  fs.writeFileSync(STORE, JSON.stringify(slim, null, 2));
  bankMtime = fs.statSync(STORE).mtimeMs;
  bank = current;
  return { saved: true, total: list.length };
}

export function stats() {
  const current = load();
  const out = {};
  for (const key of Object.keys(current)) out[key] = current[key].length;
  return out;
}
