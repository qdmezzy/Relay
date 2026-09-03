

import assert from "node:assert/strict";
import { mask, unmask, verify } from "../src/mask.js";
import { normaliseJapaneseLaughter as njl } from "../src/sanitize.js";
import { detectLanguage } from "../src/detect.js";
import { buildOutgoingSystem, buildIncomingSystem } from "../src/prompt.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("  ok   " + name); pass++; }
  catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; }
}

console.log("\nmasking");
t("protects every discord token type", () => {
  const src = 'hey <@123> check ```js\nlet x=1\n``` and `npm i` at https://a.co/b :smile: <:pepe:99> ||spoiler|| @everyone';
  const { masked, tokens } = mask(src);
  assert.equal(tokens.length, 8, "expected 8 tokens, got " + tokens.length);
  assert.ok(!masked.includes("<@123>"));
  assert.ok(!masked.includes("https://"));
  assert.equal(unmask(masked, tokens), src, "round-trip must be lossless");
});

t("survives a model mangling the placeholders", () => {
  const { tokens } = mask("yo <@42> look https://x.co");

  assert.ok(unmask("yo ⟦ 0 ⟧ look ⟦１⟧", tokens).includes("<@42>"));
  assert.ok(unmask("yo [0] look ⟦1⟧", tokens).includes("https://x.co"));
});

t("reports dropped tokens instead of silently losing them", () => {
  const { tokens } = mask("ping <@7> now");
  assert.equal(verify("핑 지금", tokens).length, 1);
  assert.equal(verify("핑 <@7> 지금", tokens).length, 0);
});

t("leaves a message with no tokens alone", () => {
  const { masked, tokens } = mask("wait no way lmaooo");
  assert.equal(tokens.length, 0);
  assert.equal(masked, "wait no way lmaooo");
});

t("placeholders are numbered left to right", () => {

  const { masked, tokens } = mask("<@123> did you see this? https://x.co/a");
  assert.equal(masked, "⟦0⟧ did you see this? ⟦1⟧", "got: " + masked);
  assert.equal(tokens[0], "<@123>");
  assert.equal(tokens[1], "https://x.co/a");
});

t("ordering holds with many interleaved tokens", () => {
  const { masked } = mask("a https://x.co b <@1> c `code` d :smile: e");
  const nums = [...masked.matchAll(/⟦(\d+)⟧/g)].map((m) => Number(m[1]));
  assert.deepEqual(nums, [0, 1, 2, 3], "got: " + nums.join(","));
});

console.log("\njapanese laughter sanitiser");
t("romaji w never survives", () => {

  assert.equal(njl("日本語めっちゃ下手www", "my japanese is so ass"), "日本語めっちゃ下手");
  assert.equal(njl("めっちゃ疲れたｗｗ", "im tired"), "めっちゃ疲れた");
});

t("w becomes 笑 when the input actually laughed", () => {
  assert.equal(njl("めっちゃ疲れたw", "im so tired lol"), "めっちゃ疲れた笑");
});

t("stronger laughter becomes 草", () => {
  assert.equal(njl("まじで面白かったwwww", "that was so funny lmao"), "まじで面白かった草");
});

t("laughter the input never had is removed, kanji included", () => {
  assert.equal(njl("今日は無理笑", "i cant today"), "今日は無理");
  assert.equal(njl("今日は無理草", "i cant today"), "今日は無理");
});

t("genuine laughter is left alone", () => {
  assert.equal(njl("まじか草", "no way lmaooo"), "まじか草");
});

t("does not eat an english word ending in w", () => {
  assert.equal(njl("check nowww", "check now"), "check nowww");
});

t("serious messages stay clean", () => {
  assert.equal(
    njl("祖母が病院にいる", "my grandma is in the hospital"),
    "祖母が病院にいる"
  );
});

console.log("\ndetection");
t("korean", () => assert.equal(detectLanguage("ㅇㅇ 나 지금 개바빠 ㅠㅠ"), "ko"));
t("japanese", () => assert.equal(detectLanguage("まじ？ めっちゃ忙しいwww"), "ja"));
t("french", () => assert.equal(detectLanguage("ouais je sais pas mec c'est chelou"), "fr"));
t("english", () => assert.equal(detectLanguage("nah im good lmao"), "en"));
t("empty is null", () => assert.equal(detectLanguage("   "), null));

console.log("\nprompt assembly");
const you = { name: "me", style: ["all lowercase", "no periods"] };

t("korean banmal prompt bans polite endings", () => {
  const p = buildOutgoingSystem({ target: "ko", register: "banmal", you, profile: {} });
  assert.ok(p.includes("반말"), "must name the register");
  assert.ok(p.includes("NEVER -요"), "must explicitly ban -요");
  assert.ok(p.includes("all lowercase"), "must carry the writer's style notes");
  assert.ok(p.includes("Never make it more polite"), "must carry the core prohibition");
});

t("japanese plain form bans desu/masu", () => {
  const p = buildOutgoingSystem({ target: "ja", register: "tameguchi", you, profile: {} });
  assert.ok(p.includes("NEVER です・ます"));
});

t("french familier bans the ne", () => {
  const p = buildOutgoingSystem({ target: "fr", register: "tu_familier", you, profile: {} });
  assert.ok(p.includes("je sais pas"));
  assert.ok(p.toLowerCase().includes("tutoiement"));
});

t("register actually changes the prompt", () => {
  const casual = buildOutgoingSystem({ target: "ko", register: "banmal", you, profile: {} });
  const formal = buildOutgoingSystem({ target: "ko", register: "formal", you, profile: {} });
  assert.notEqual(casual, formal);
  assert.ok(formal.includes("합쇼체"));
});

t("glossary entries land in the prompt", () => {
  const p = buildOutgoingSystem({
    target: "ja", register: "tameguchi", you,
    profile: { glossary: { "Mochi": null, "raid": "レイド" }, notes: ["met through a game"] },
  });
  assert.ok(p.includes("leave exactly as-is"), "null glossary value = do not translate");
  assert.ok(p.includes("レイド"));
  assert.ok(p.includes("met through a game"));
});

t("incoming prompt is reader-facing, not writer-facing", () => {
  const p = buildIncomingSystem({ source: "ko", you });
  assert.ok(p.includes("into English"));
  assert.ok(!p.includes("You are not a translator"));
});

t("unknown language fails loudly", () => {
  assert.throws(() => buildOutgoingSystem({ target: "de", you, profile: {} }), /Unknown language/);
});

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
