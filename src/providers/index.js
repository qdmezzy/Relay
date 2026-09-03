import { createOllamaProvider } from "./ollama.js";

export async function createProvider(config) {
  const name = config.provider;
  const cfg = config.providers?.[name] ?? {};

  switch (name) {
    case "ollama":
      return createOllamaProvider(cfg);

    case "anthropic": {
      let mod;
      try {
        mod = await import("./anthropic.js");
      } catch (err) {
        if (err?.code === "ERR_MODULE_NOT_FOUND") {
          throw new Error(
            "The anthropic backend needs its SDK installed first.\nRun:  npm install"
          );
        }
        throw err;
      }
      return mod.createAnthropicProvider(cfg);
    }

    default:
      throw new Error(
        'Unknown provider "' + name + '" in config.json. Use "ollama" or "anthropic".'
      );
  }
}
