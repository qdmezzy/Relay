

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

console.log("\nquestions");
const { checkSpeechAct } = await import("../src/sanitize.js");

t("a question word counts as asking, even with no question mark", () => {
  assert.equal(checkSpeechAct("너 뭐해 ㅋㅋㅋ", "what are you doing lol"), null);
  assert.equal(checkSpeechAct("어디야", "where are you"), null);
  assert.equal(checkSpeechAct("どこにいる", "where are you"), null);
});

t("a yes/no question still wants the mark", () => {
  assert.match(
    checkSpeechAct("아직 통화 중이야", "are you still in the call") ?? "",
    /came back as a statement/
  );
});

t("a question word inside a statement is not a question", () => {
  assert.equal(checkSpeechAct("왜인지 모르겠어", "i dont know why"), null);
});

t("a statement that came back asking is still caught", () => {
  assert.match(
    checkSpeechAct("나 이제 잔다?", "im going to bed now") ?? "",
    /came back as a question/
  );
});

console.log("\nmemory");
const os = await import("node:os");
const nodePath = await import("node:path");
const nodeFs = await import("node:fs");
const store = nodePath.join(os.tmpdir(), "relay-memory-test-" + process.pid + ".json");
process.env.RELAY_MEMORY = store;
const { recall, remember, stats } = await import("../src/memory.js");

t("an empty bank recalls nothing", () => {
  assert.deepEqual(recall("ko", "anything at all"), []);
});

t("a saved correction comes back for the same message", () => {
  remember("ko", "wanna play minecraft tonight?", "오늘 밤에 마크 할래?");
  const hits = recall("ko", "wanna play minecraft tonight?");
  assert.equal(hits[0].source, "wanna play minecraft tonight?");
  assert.equal(hits[0].translation, "오늘 밤에 마크 할래?");
});

t("it also comes back for a message that only looks similar", () => {
  const hits = recall("ko", "wanna play minecraft later?");
  assert.ok(hits.length, "expected the minecraft pair back");
  assert.ok(hits[0].score > 0.4, "score was only " + hits[0].score);
});

t("something unrelated recalls nothing", () => {
  assert.deepEqual(recall("ko", "the mortgage paperwork arrived"), []);
});

t("a closer match outranks a looser one", () => {
  remember("ko", "im so tired", "나 개피곤해");
  const hits = recall("ko", "wanna play minecraft tomorrow?");
  assert.equal(hits[0].source, "wanna play minecraft tonight?");
});

t("correcting the same message replaces it instead of stacking", () => {
  remember("ko", "im so tired", "나 진짜 피곤해");
  const hits = recall("ko", "im so tired");
  const mine = hits.filter((h) => h.source === "im so tired");
  assert.equal(mine.length, 1, "ended up with " + mine.length + " copies");
  assert.equal(mine[0].translation, "나 진짜 피곤해");
});

t("the bank is kept per language", () => {
  assert.equal(stats().ko, 2);
  assert.equal(stats().ja, 0);
  assert.deepEqual(recall("ja", "wanna play minecraft tonight?"), []);
});

t("junk in is refused", () => {
  assert.equal(remember("ko", "", "something").saved, false);
  assert.equal(remember("de", "hi", "hallo").saved, false);
});

try { nodeFs.unlinkSync(store); } catch {}

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
