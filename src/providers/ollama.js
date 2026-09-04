

export function createOllamaProvider(cfg) {
  const host = (cfg.host || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const model = cfg.model || "translategemma:4b";
  const temperature = cfg.temperature ?? 0.3;

  return {
    name: "ollama:" + model,

    async translate({ system, user, shots = [], signal, model: modelOverride, temperature: tempOverride }) {
      const model = modelOverride || cfg.model || "translategemma:4b";
      const res = await post(host + "/api/chat", signal, {
          model,
          stream: false,

          think: false,
          messages: [
            { role: "system", content: system },
            ...shots,
            { role: "user", content: user },
          ],
          options: {
            temperature: tempOverride ?? temperature,
            num_predict: 512,
            // ollama defaults to a 4096 window and the examples alone eat about
            // 3.5k of it, so long messages used to fall off the front
            num_ctx: 8192,
          },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (res.status === 404) {
          throw new Error(
            'Ollama does not have the model "' + model + '" pulled.\n' +
              "Run:  ollama pull " + model
          );
        }
        throw new Error("Ollama HTTP " + res.status + ": " + body.slice(0, 300));
      }

      const json = await res.json();
      const text = json?.message?.content ?? "";

      return {
        text: stripThinking(text),
        usage: {
          input: json.prompt_eval_count ?? 0,
          output: json.eval_count ?? 0,
          cost: 0,
        },
      };
    },

    async healthcheck() {
      const res = await fetch(host + "/api/tags").catch(() => null);
      if (!res || !res.ok) {
        throw new Error(
          "Cannot reach Ollama at " + host + ".\n" +
            "Start it (it usually runs as a tray app) or install it: https://ollama.com/download"
        );
      }
      const { models = [] } = await res.json();
      const names = models.map((m) => m.name);
      const base = model.split(":")[0];
      if (!names.some((n) => n === model || n.startsWith(base + ":"))) {
        throw new Error(
          'Ollama is running but "' + model + '" is not pulled.\n' +
            "Run:  ollama pull " + model + "\n" +
            (names.length ? "You currently have: " + names.join(", ") : "You have no models pulled yet.")
        );
      }
    },
  };
}

async function post(url, signal, body) {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    const host = new URL(url).origin;
    throw new Error(
      "Cannot reach Ollama at " + host + ".\n" +
        "  - If it's installed, start it (it runs as a tray app).\n" +
        "  - If it isn't: https://ollama.com/download , then: ollama pull translategemma:4b"
    );
  }
}

function stripThinking(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}
