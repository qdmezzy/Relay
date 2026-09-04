import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packaged = Boolean(process.pkg) || process.argv[1] === process.execPath;
export const ROOT = packaged ? path.dirname(process.execPath) : path.resolve(here, "..");
// TYPE_TRANSLATE_CONFIG is the old name from before the rename. an installed
// copy of the app can be running an older shell that still sets it, and losing
// the path silently means the server quietly loads default settings instead of
// mine, so keep answering to both.
const configFromEnvironment = process.env.RELAY_CONFIG || process.env.TYPE_TRANSLATE_CONFIG;
export const CONFIG_PATH = configFromEnvironment
  ? path.resolve(configFromEnvironment)
  : path.join(ROOT, "config.json");

let cached = null;
let cachedMtime = 0;

export function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") throw new Error("No config.json found at " + CONFIG_PATH);
    throw new Error("config.json is not valid JSON: " + err.message);
  }
}

export function keyFromEnvironment() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function loadConfig() {
  let stat;
  try {
    stat = fs.statSync(CONFIG_PATH);
  } catch {
    throw new Error(
      "No config.json found at " + CONFIG_PATH + "\nCopy config.example.json to config.json and edit it."
    );
  }

  if (cached && stat.mtimeMs === cachedMtime) return cached;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    throw new Error("config.json is not valid JSON: " + err.message);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    parsed.providers = parsed.providers || {};
    parsed.providers.anthropic = parsed.providers.anthropic || {};
    parsed.providers.anthropic.apiKey = process.env.ANTHROPIC_API_KEY;
  }

  cached = parsed;
  cachedMtime = stat.mtimeMs;
  return parsed;
}

export function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const temp = CONFIG_PATH + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", "utf8");
  fs.renameSync(temp, CONFIG_PATH);
  cached = null;
  cachedMtime = 0;
  return loadConfig();
}

export function resolveProfile(config, target, profileName) {
  const profiles = config.profiles || {};
  if (profileName && profiles[profileName]) return profiles[profileName];

  const match = Object.values(profiles).find(
    (p) => p.lang === target && p.default
  );
  if (match) return match;

  return { lang: target, register: undefined, glossary: {}, notes: [] };
}
