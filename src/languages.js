

export const LANGUAGES = {
  ko: {
    name: "Korean",
    endonym: "한국어",
    laughter: 'ㅋㅋ / ㅋㅋㅋ / ㅋㅋㅋㅋㅋ — length scales with how funny it is. "ㅎㅎ" is softer/warmer, "ㅠㅠ"/"ㅜㅜ" is crying (sad OR laughing-crying).',
    defaultRegister: "banmal",
    registers: {
      banmal: {
        label: "반말 (plain / intimate)",
        spec: [
          "Write in 반말 (banmal) throughout. This is non-negotiable — the person being written to is a close friend.",
          "Verb endings: -아/-어, -야, -지, -네, -자, -ㄹ래, -거든. NEVER -요 and NEVER -습니다/-ㅂ니다.",
          "Drop subject particles constantly the way people actually text (밥 먹었어? not 너는 밥을 먹었니?).",
          "Use 야/아 vocatives, 응/어/ㅇㅇ for yes, 아니/ㄴㄴ for no.",
          "Internet Korean is correct here: ㅇㅇ, ㄴㄴ, ㄱㅅ, ㅇㅋ, 헐, 대박, 진짜?, 개- as an intensifier (개웃겨, 개좋아).",
          "If the input is soft or affectionate, 반말 + ~ tildes and ㅎㅎ carries that. Do not reach for polite forms to sound warm — in 반말 that reads as distance.",
        ],
      },
      haeyo: {
        label: "해요체 (polite informal)",
        spec: [
          "Write in 해요체. Endings in -아요/-어요/-예요. Friendly but not intimate — a coworker you like, an older acquaintance, someone you just met.",
          "Do NOT escalate to -습니다/-ㅂ니다. That is a different, stiffer register and it will read as cold.",
          "Slang is still fine at this level, just less of it. 헐/진짜요?/대박 all work.",
        ],
      },
      formal: {
        label: "합쇼체 (formal polite)",
        spec: [
          "Write in 합쇼체: -습니다/-ㅂ니다/-십시오. Business, official, or addressing someone much senior.",
          "No internet slang, no ㅋㅋ, no abbreviations.",
        ],
      },
    },
  },

  ja: {
    name: "Japanese",
    endonym: "日本語",
    laughter:
      'Use the kanji forms, NOT the romaji "w". 笑 at the end of a sentence is the everyday "lol". 草 is stronger - "lmao" / "that\'s hilarious" - and can stand alone as its own message. For something genuinely very funny, 大草原 or 草生える. Never write w, ww, or wwww.',
    defaultRegister: "tameguchi",
    registers: {
      tameguchi: {
        label: "タメ口 / 常体 (plain form)",
        spec: [
          "Write in plain form (常体 / タメ口) throughout. Close friend. This is non-negotiable.",
          "Sentence endings: だ / だよ / だね / じゃん / でしょ / かな / よね / っけ. NEVER です・ます.",
          "Drop particles the way people text: 明日行く? not 明日に行きますか?",
          "Casual contractions are correct: てる (not ている), とく (not ておく), ちゃう (not てしまう), なきゃ, じゃん.",
          "Internet/texting Japanese is correct here: めっちゃ, やば/やばい, まじ?, それな, ワンチャン, ええ〜, 〜www.",
          "Small kana (ぇ, ぁ, っ) and 〜 stretch marks carry tone. Use them where the English has stretched vowels or trailing energy.",
        ],
      },
      teineigo: {
        label: "です・ます体 (polite form)",
        spec: [
          "Write in です・ます form. Polite but normal — a coworker, someone you don't know well.",
          "Do NOT use 敬語 (謙譲語/尊敬語) unless the input is genuinely deferential. です・ます is already polite; adding honorifics on top reads as either sarcastic or like a customer service bot.",
          "Light casual vocabulary is still fine (めっちゃ, ちょっと), just no タメ口 endings.",
        ],
      },
      keigo: {
        label: "敬語 (honorific / business)",
        spec: [
          "Full 敬語: 謙譲語 for your own actions, 尊敬語 for theirs. Business email / client register.",
          "No slang, no w, no 顔文字.",
        ],
      },
    },
  },

  fr: {
    name: "French",
    endonym: "français",
    laughter: 'mdr / ptdr / lol / jpp ("j\'en peux plus"). "ptdr" is stronger than "mdr". "😭" and "je suis mort" work like English "i\'m dead".',
    defaultRegister: "tu_familier",
    registers: {
      tu_familier: {
        label: "tu + familier (casual)",
        spec: [
          "Tutoiement throughout — 'tu', never 'vous'. Close friend. Non-negotiable.",
          "Drop the 'ne' in negation, always: 'je sais pas', 'j'ai pas envie', 'c'est pas grave'. Writing 'je ne sais pas' in a text to a friend is the single biggest tell of machine translation.",
          "Casual spoken forms: 'ouais' not 'oui', 't'as' / 't'es' / 'y'a' / 'chais pas', 'ça' not 'cela'.",
          "Register-appropriate slang: truc, mec, meuf, ouf, chelou, grave, trop, carrément, genre, du coup, franchement, bref.",
          "Questions are formed by intonation, not inversion: 'tu viens ?' not 'viens-tu ?'. Never use inversion in casual text.",
          "French convention puts a space before ? ! : and ; — keep that only if the input's own punctuation habits allow it; if the writer is sloppy with punctuation, be sloppy the same way.",
        ],
      },
      tu_neutre: {
        label: "tu + neutre",
        spec: [
          "Tutoiement, but standard written French. Keep the 'ne' in negation.",
          "No heavy slang, but not stiff either. A friendly message you'd be fine with anyone reading.",
        ],
      },
      vous: {
        label: "vous + soutenu (formal)",
        spec: [
          "Vouvoiement throughout — 'vous'. Full negation with 'ne'. Standard formal written French.",
          "No slang, no abbreviations, no dropped particles.",
        ],
      },
    },
  },

  en: {
    name: "English",
    endonym: "English",
    laughter: "lol / lmao / lmfao / hahaha — pick the intensity that matches the source, not the safest one.",
    defaultRegister: "casual",
    registers: {
      casual: {
        label: "casual texting English",
        spec: [
          "Normal casual English the way a person actually texts — contractions, fragments, lowercase where natural.",
          "Do not write like a subtitle track. 'What are you doing?' is worse than 'wyd' if the source was that casual.",
        ],
      },
      neutral: {
        label: "neutral English",
        spec: ["Standard conversational English. Complete sentences, no slang, but not formal either."],
      },
    },
  },
};

export const CHAT_TERMS = {
  ja: [
    '"call" / "vc" / "voice chat" here always means a Discord voice call: 通話 (or VC). Never 呼ぶ / 電話 - those are summoning someone and a phone call.',
    '"in the call" = 通話に入ってる / 通話中. "sleep in the call" = 通話つないだまま寝る (sleeping with the call still connected) - a normal thing friends do, not a strange one.',
    '"gc" = グループ通話. "dm" = DM. "server" = サーバー. "ping/pinged" = メンション（する）.',
    '"afk" = 離席. "gg" = お疲れ / GG. "lag" = ラグ. "carry" = キャリー. "grind" = 周回.',
    '"stream" = 配信. "mute" = ミュート. "deafen" = スピーカーミュート.',
    '"smurf" = スマーフ (a strong player on a low-rank account). "feeding" = 死にすぎ / フィードしてる. "int" = わざと negative play. "run it back" = もう一回. "queue pop" = マッチ来た. "clutch" = クラッチ / ナイス. "nerf" = ナーフ, "buff" = バフ. "ranked grind" = ランク回す.',
    '"cracked" = 強すぎ / バケモン. "washed" = 衰えた / 落ちぶれた. "cooked" = 終わった. "sus" = 怪しい. "goes hard" = やばい / 神. "bet" / "say less" = りょ / 了解. "a W" = 勝ち, "an L" = 負け. "cope" = 現実見ろ. "mid" = 微妙.',
    'Game names use the short form Japanese players actually type: minecraft = マイクラ, league of legends = LoL, valorant = ヴァロ, overwatch = OW, fortnite = フォトナ, apex = エペ, among us = アモアス, pubg = PUBG, genshin = 原神, roblox = ロブロックス, discord = ディスコ. "wanna play minecraft" = マイクラやる？',
    'Never invent a katakana spelling for a product or game you do not know. Leave it in Latin letters as written.',
  ],
  ko: [
    '"call" / "vc" / "voice chat" here always means a Discord voice call: 통화 (or 보이스). Never 전화 unless it really is a phone call.',
    '"in the call" = 통화 중 / 통화 들어와 있다. "sleep in the call" = 통화 켜놓고 자다.',
    '"gc" = 단체 통화. "dm" = DM / 디엠. "server" = 서버. "ping/pinged" = 멘션(하다).',
    '"afk" = 잠수. "gg" = ㅈㅈ / 수고. "lag" = 렉. "carry" = 캐리. "grind" = 노가다.',
    '"stream" = 방송 / 스트리밍. "mute" = 음소거.',
    '"smurf" = 부계 (a strong player on a smurf account). "feeding" = 피딩 / 계속 죽어. "run it back" = 한 판 더. "queue pop" = 큐 잡혔다. "clutch" = 클러치 / 개잘했다. "nerf" = 너프, "buff" = 버프. "ranked grind" = 랭겜 돌리다.',
    '"cracked" = 개잘해 / 괴물. "washed" = 한물 갔다. "cooked" = 망했다. "sus" = 수상해. "goes hard" = 개쩐다. "bet" / "say less" = ㅇㅋ / 콜. "a W" = 개이득, "an L" = 망함. "cope" = 정신승리. "mid" = 그냥 그래.',
    'Game names use the short form Korean players actually type: minecraft = 마크, league of legends = 롤, valorant = 발로, overwatch = 옵치, fortnite = 포트나이트, pubg / battlegrounds = 배그, apex = 에이펙스, among us = 어몽어스, genshin = 원신, roblox = 로블록스, counter strike = 카스, discord = 디코. "wanna play minecraft" = 마크 할래?',
    'NEVER invent a Korean spelling for a product or game you do not know. Leave it in Latin letters exactly as written - Korean players type unfamiliar game names in English all the time. Guessing produced 막스 케이스 for "minecraft", which means nothing.',
  ],
  fr: [
    '"call" / "vc" / "voice chat" here always means a Discord voice call: vocal (or "appel" / "call", both used). Never "appeler quelqu\'un" in the summoning sense.',
    '"in the call" = en vocal / dans le vocal. "sleep in the call" = dormir en vocal.',
    '"gc" = vocal de groupe. "dm" = DM / MP. "server" = serveur. "ping/pinged" = ping / mentionner.',
    '"afk" = afk. "gg" = gg. "lag" = lag. "carry" = carry / porter. "grind" = farm / farmer.',
    '"stream" = stream. "mute" = mute / couper le micro.',
    '"smurf" = smurf. "feeding" = il feed. "run it back" = on remet ca. "queue pop" = ca a pop. "clutch" = clutch. "nerf" / "buff" stay as-is. "ranked grind" = farmer la ranked.',
    '"cracked" = il est trop fort / une machine. "washed" = il a chute. "cooked" = je suis foutu. "sus" = louche. "goes hard" = ca envoie. "bet" / "say less" = ca marche. "a W" = une win, "an L" = une defaite. "cope" = accepte. "mid" = moyen.',
    'Game names stay in Latin exactly as written - Minecraft, Valorant, Roblox, Fortnite. French players do not translate them. League of Legends is "LoL", Overwatch is "OW". "wanna play minecraft" = on joue a minecraft ?',
  ],
  en: [
    "The sender is on Discord. 通話 / 통화 / vocal mean the voice call, so render them as \"the call\" or \"vc\", not \"phone call\".",
    "通話つないだまま寝る / 통화 켜놓고 자다 / dormir en vocal all mean sleeping with the voice call still connected - \"sleeping in the call\".",
    "Keep gaming shorthand as shorthand: 離席/잠수 = afk, ラグ/렉 = lag, 配信/방송 = stream, キャリー/캐리 = carry.",
    "Korean consonant shorthand is not all the same word - do not default to \"gg\" for anything you do not recognise. ㅇㅇ = yeah, ㄴㄴ = nah, ㅇㅋ = ok, ㄱㅅ = thanks, ㅅㄱ = later / nice work, ㄱㄱ = let's go, ㅈㅈ = gg (surrender), ㅇㅈ / 인정 = facts, ㄱㅊ = it's fine, ㅂㅂ = bye, ㅊㅋ = congrats, ㅁㅊ = crazy, ㅎㅇ = hey.",
    "콜 is \"I'm in\" / \"deal\" (from poker), never a phone call. 각 is an opening or a chance - \"각 나왔다\" is \"there's an opening\". 빡친다 = pissed off. 짱 = the best.",
  ],
};

export function getChatTerms(code) {
  return CHAT_TERMS[code] ?? null;
}

export const SPEECH_STYLES = {
  ja: {
    masculine: [
      "Speak as a man. 俺 for 'I'. Endings like 〜だ / 〜だろ / 〜ぜ / 〜な are fine.",
      "Never use 〜かしら, 〜だわ, 〜のよ, 〜ですこと, あたし - these read distinctly feminine.",
    ],
    "masculine-neutral": [
      "Speak as a man, but relaxed rather than rough. 俺 for 'I' (僕 if the message is gentle).",
      "わかんない / だな / 〜わ / 〜けど are all fine. わかんねえよ and 〜だぜ are fine only when the input is genuinely that blunt - do not reach for them by default.",
      "Never use 〜かしら, 〜だわ (feminine), 〜のよ, あたし.",
    ],
    neutral: [
      "Avoid markers that read strongly as either gender. Prefer 〜だ / 〜だね / 〜かな and plain forms.",
      "Avoid 俺 and あたし alike; drop the pronoun entirely wherever Japanese allows it, which is most of the time.",
    ],
    feminine: [
      "Speak as a woman. あたし or 私 for 'I'. 〜だわ / 〜のよ / 〜かしら / 〜ね are available.",
      "Avoid 俺, 〜だぜ, 〜やがる.",
    ],
  },
  ko: {
    masculine: [
      "Speak as a man. 나 for 'I'. Blunt endings (〜다, 〜냐, 〜자, 〜지) are fine.",
      "Avoid aegyo patterns: stretched 〜앙 / 〜엉 / 〜용 endings, 〜당, and heavy ㅎㅎ softening.",
    ],
    "masculine-neutral": [
      "Speak as a man, relaxed rather than blunt. 나 for 'I'.",
      "Normal 반말 endings (〜어, 〜야, 〜지, 〜네) throughout. ㅋㅋ is fine; heavy ㅎㅎ softening and stretched 〜앙 / 〜엉 / 〜용 aegyo endings are not.",
    ],
    neutral: [
      "Plain 반말 with no gendered colouring. 나 for 'I'.",
      "Avoid both aegyo endings and deliberately blunt 〜다/〜냐 forms.",
    ],
    feminine: [
      "Speak as a woman. 나 for 'I'. ㅎㅎ, 〜용, 〜당 and softened endings are available where the tone fits.",
    ],
  },
  fr: {

    masculine: [
      "The writer is male: every past participle and adjective describing them takes the MASCULINE form. 'je suis mort', 'je suis content', 'je suis fatigué', 'je suis alle' - never the -e forms.",
    ],
    "masculine-neutral": [
      "The writer is male: every past participle and adjective describing them takes the MASCULINE form. 'je suis mort', 'je suis content', 'je suis fatigué' - never 'morte', 'contente', 'fatiguée'.",
    ],
    neutral: [
      "The writer's gender is unstated. Prefer phrasings that avoid agreement entirely ('j'ai trop dormi' rather than 'je suis fatigué(e)'). Where agreement is unavoidable, use the masculine, which is the unmarked default in French.",
    ],
    feminine: [
      "The writer is female: every past participle and adjective describing them takes the FEMININE form. 'je suis morte', 'je suis contente', 'je suis fatiguée'.",
    ],
  },
};

export function getSpeechStyle(code, style) {
  const perLang = SPEECH_STYLES[code];
  if (!perLang) return null;
  return perLang[style || "neutral"] ?? perLang.neutral ?? null;
}

export function getLanguage(code) {
  const lang = LANGUAGES[code];
  if (!lang) {
    throw new Error(
      `Unknown language "${code}". Known: ${Object.keys(LANGUAGES).join(", ")}`
    );
  }
  return lang;
}

export function getRegister(code, registerName) {
  const lang = getLanguage(code);
  const key = registerName || lang.defaultRegister;
  const reg = lang.registers[key];
  if (!reg) {
    throw new Error(
      `Unknown register "${key}" for ${code}. Known: ${Object.keys(lang.registers).join(", ")}`
    );
  }
  return reg;
}
