// builds the sweep corpus by combination. hand writing thousands of messages is
// not realistic, and it would not help - failures cluster by pattern (game
// names, negation, questions staying questions), not by individual sentence.
// templates cover a pattern across every wording it shows up in.

const CRY = String.fromCodePoint(0x1f62d);
const JOY = String.fromCodePoint(0x1f602);
const SKULL = String.fromCodePoint(0x1f480);

const LAUGHS = ["", " lol", " lmao", " lmaooo", " " + CRY, " " + JOY];
const OPENERS = ["", "yo ", "hey ", "bro ", "wait ", "ok ", "nah "];
const TIMES = [
  "later", "tonight", "tomorrow", "after this", "in a bit", "in 20 mins",
  "this weekend", "after work", "in an hour", "now", "next week", "friday",
];

const GAMES = [
  "minecraft", "valorant", "league", "roblox", "fortnite", "overwatch", "apex",
  "among us", "cs2", "rocket league", "terraria", "stardew", "phasmophobia",
  "deep rock galactic", "lethal company", "helldivers", "rust", "sea of thieves",
];

const FEELINGS = [
  "tired", "so tired", "hungry", "bored", "sad", "happy", "stressed", "nervous",
  "sick", "annoyed", "excited", "confused", "broke", "cooked", "washed", "done",
  "lonely", "scared", "proud", "embarrassed", "cold", "hot", "sleepy", "full",
];

const REACTIONS = [
  "thats crazy", "thats wild", "no way", "wait what", "thats so unfair",
  "im dying", "thats rough", "good for you", "finally", "oh great", "thats mid",
  "thats fire", "thats sus", "bet", "say less", "cope", "thats a W", "took the L",
  "hes cracked", "that goes hard", "im cooked", "no cap", "lowkey agree", "same",
];

const NEGATIONS = [
  "i dont know", "i dont think so", "i havent eaten", "i cant come",
  "dont worry about it", "i never said that", "nobody told me", "im not mad",
  "theres nothing left", "i didnt do it", "no one came", "i dont care",
  "thats not what i meant", "i cant hear you", "it doesnt work", "i dont have it",
  "she didnt reply", "we didnt win", "im not going", "it wasnt me",
];

const QUESTIONS = [
  "did you eat yet", "what are you doing", "where are you", "how was your day",
  "did you see that", "are you ok", "whats your favorite game", "why didnt you tell me",
  "how long does it take", "do you want anything", "who else is coming",
  "are you still in the call", "can you send me that link", "what time",
  "you free tonight", "is it done yet", "did it work", "how much was it",
  "what did you say", "when do you get off work", "have you seen my charger",
  "whats for dinner", "do you like it", "can i call you", "are you coming or not",
];

const VC = [
  "get in vc", "im gonna hop off", "my mic is being weird", "i cant hear you",
  "youre breaking up", "can you unmute", "brb afk", "im back", "im in the call",
  "who's in vc", "join the call", "im gonna sleep in the call", "youre so quiet",
  "turn up your mic", "im muted sorry", "my headset died",
];

const FOOD = [
  "im making ramen", "wanna get food", "i just ate", "im starving",
  "this is so good", "i burnt it", "im ordering pizza", "did you eat",
  "im on a diet", "lets get boba", "the food was mid", "im cooking rn",
];

const WORK_SCHOOL = [
  "i have work at 9", "im studying for exams", "i failed the test", "i got an A",
  "my boss is annoying", "i have a presentation tomorrow", "class got cancelled",
  "im working late", "i quit my job", "i got promoted", "the deadline is friday",
  "i overslept and missed class", "my group project partner did nothing",
];

const HOME_FAMILY = [
  "my sister is visiting", "my mom is calling me", "i have to clean my room",
  "my dog wont stop barking", "im moving next month", "my brother took my charger",
  "im at my grandmas", "my parents are out", "i have to babysit",
];

const MONEY = [
  "im broke", "it costs like 30 bucks", "i just got paid", "thats too expensive",
  "i spent way too much", "can you spot me", "ill pay you back", "its on sale",
  "i wasted my money", "im saving up for a new pc",
];

const TRANSPORT = [
  "im on the bus", "traffic is insane", "i missed my train", "im walking there",
  "my car broke down", "ill drive", "im omw", "im stuck in traffic",
  "the flight got delayed", "i took an uber",
];

const HEALTH = [
  "i have a headache", "i think im getting sick", "i barely slept",
  "my back hurts", "i went to the doctor", "i need to sleep more",
  "im so out of shape", "i went to the gym",
];

const MEDIA = [
  "have you seen that show", "this song is so good", "the movie was mid",
  "im rewatching it", "no spoilers", "the ending was insane",
  "i cant stop listening to this", "put on something else",
];

const SOCIAL = [
  "sorry i forgot", "my bad", "thanks so much", "no worries", "hope you feel better",
  "you got this", "congrats dude", "im here if you need me", "good luck tomorrow",
  "happy birthday", "sorry i fell asleep", "long time no see",
];

const TEASING = [
  "youre so bad at this", "shut up", "youre such an idiot", "youre the worst",
  "get good", "you literally cried", "i carried you", "stop yapping",
];

const REQUESTS = [
  "let me know", "wait for me", "send it here", "hit me up later",
  "dont tell anyone", "call me when youre free", "remind me tomorrow",
  "come pick me up", "save me a seat",
];

const COMPOUND = [
  "i was gonna come but my mom needs the car",
  "sorry i fell asleep, i just woke up",
  "if youre free later we could play",
  "i finished the essay but its really bad",
  "tell him i said hi",
  "i wanted to go but i have work in the morning",
  "she said she'd come but she never showed up",
  "im almost done, give me like 10 minutes",
];

const SERIOUS = [
  "my grandma is in the hospital", "i failed the exam", "i lost my job",
  "im really sorry about earlier", "my dog died", "i got fired",
  "im in the hospital", "my mom is sick", "we broke up", "i need to talk to you",
];

const SYNTAX = [
  "<@123456> did you see this?", "check this https://x.co/abc",
  "look at this :smile:", "||spoiler|| dont read it", "`npm install` first",
  "<@123456> https://x.co/abc :wave:", "im so tired " + CRY,
  "that was funny " + JOY, "im dead " + SKULL,
];

const push = (out, text, tag, must = null) => {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed) out.push({ text: trimmed, tag, must });
};

// every opener x every laugh, for patterns where wording variation is the point
function spread(out, lines, tag, laughs = LAUGHS, openers = OPENERS) {
  for (const line of lines) {
    for (const opener of openers) {
      for (const laugh of laughs) push(out, opener + line + laugh, tag);
    }
  }
}

export function buildCorpus() {
  const out = [];

  for (const game of GAMES) {
    const name = game.split(" ")[0];
    for (const time of TIMES) push(out, `wanna play ${game} ${time}?`, "gaming", [[name]]);
    push(out, `anyone wanna play ${game}?`, "gaming", [[name]]);
    push(out, `im playing ${game}`, "gaming", [[name]]);
    push(out, `lets play ${game}`, "gaming", [[name]]);
    push(out, `anyone on ${game}`, "gaming", [[name]]);
    push(out, `i cant play ${game} tonight`, "gaming", [[name], ["cant", "can't", "not"]]);
  }

  spread(out, FEELINGS.map((f) => `im ${f}`), "feeling");
  spread(out, REACTIONS, "reaction");
  spread(out, NEGATIONS, "negation");
  spread(out, QUESTIONS, "question", LAUGHS.slice(0, 3));
  spread(out, VC, "vc", LAUGHS.slice(0, 3));
  spread(out, FOOD, "food", LAUGHS.slice(0, 3));
  spread(out, WORK_SCHOOL, "work", LAUGHS.slice(0, 3));
  spread(out, HOME_FAMILY, "home", LAUGHS.slice(0, 3));
  spread(out, MONEY, "money", LAUGHS.slice(0, 3));
  spread(out, TRANSPORT, "transport", LAUGHS.slice(0, 3));
  spread(out, HEALTH, "health", LAUGHS.slice(0, 3));
  spread(out, MEDIA, "media", LAUGHS.slice(0, 3));
  spread(out, SOCIAL, "social", LAUGHS.slice(0, 3));
  spread(out, TEASING, "teasing", LAUGHS.slice(0, 4));
  spread(out, REQUESTS, "request", LAUGHS.slice(0, 2));
  spread(out, COMPOUND, "compound", LAUGHS.slice(0, 2), ["", "yo "]);

  for (const time of TIMES) {
    push(out, `im free ${time}`, "plans", [["free", "time", "available"]]);
    push(out, `cant ${time} sorry`, "plans", [["cant", "can't", "not", "sorry"]]);
    push(out, `lets do it ${time}`, "plans");
    push(out, `are we still on for ${time}`, "plans");
    push(out, `ill be there ${time}`, "plans");
    push(out, `you free ${time}?`, "plans");
  }

  // these must never come out jokey, so no laugh suffixes
  for (const line of SERIOUS) {
    push(out, line, "serious");
    push(out, "hey " + line, "serious");
    push(out, line + " :(", "serious");
  }

  for (const line of SYNTAX) push(out, line, "syntax");

  // dedupe - openers and laughs overlap in places
  const seen = new Set();
  return out.filter((entry) => {
    const key = entry.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const LANGS = ["ko", "ja", "fr"];
