import Anthropic from "@anthropic-ai/sdk";

const PRICING = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

export function createAnthropicProvider(cfg) {
  const model = cfg.model || "claude-opus-5";
  const effort = cfg.effort || "low";

  const client = new Anthropic(
    cfg.apiKey ? { apiKey: cfg.apiKey } : undefined
  );

  return {
    name: "anthropic:" + model,

    async translate({ system, user, shots = [], signal, model: modelOverride }) {
      const res = await client.messages.create(
        {
          model: modelOverride || model,
          max_tokens: 4000,
          output_config: { effort },
          system: [
            {
              type: "text",
              text: system,

              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [...shots, { role: "user", content: user }],
        },
        { signal }
      );

      if (res.stop_reason === "refusal") {
        throw new Error(
          "The model declined this message" +
            (res.stop_details?.explanation ? ": " + res.stop_details.explanation : ".")
        );
      }

      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      return { text, usage: buildUsage(model, res.usage) };
    },

    async healthcheck() {
      try {
        await client.models.retrieve(model);
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) {
          throw new Error(
            "Anthropic rejected the credentials. Set ANTHROPIC_API_KEY, or run: ant auth login"
          );
        }
        if (err instanceof Anthropic.NotFoundError) {
          throw new Error('Unknown model id "' + model + '" - check config.json.');
        }
        throw err;
      }
    },
  };
}

function buildUsage(model, usage) {
  if (!usage) return { input: 0, output: 0, cost: 0 };

  const fresh = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;

  const p = PRICING[model];
  const cost = p
    ? (fresh * p.input +
        cacheWrite * p.input * 1.25 +
        cacheRead * p.cacheRead +
        output * p.output) /
      1_000_000
    : 0;

  return { input: fresh + cacheRead + cacheWrite, output, cacheRead, cost };
}
