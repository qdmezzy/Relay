<h1>Relay</h1>

Type in English, send in Korean, Japanese or French — without it turning your
message into a customer service email.

Sits in the Windows tray and works in any app you can type in.

![Relay](docs/relay.png)

## What it does

**Auto translate.** Pick a language, then type and press Enter like normal. Your
message goes out translated.

**Highlight to read.** Select someone's message and the English pops up next to
your cursor.

**Quick translate.** Two panes in the app for checking something before you send
it.

The point is that it keeps how you actually write. Lowercase, no periods,
swearing, however much you use "lol" — and the right level of formality for each
language. 반말 not 해요체, タメ口 not です・ます, tu not vous.

## Install

Grab one from [releases](https://github.com/qdmezzy/relay/releases):

| | |
|---|---|
| `Relay-Setup-*.exe` | Installer. Shortcuts, uninstall entry, updates itself. |
| `Relay-*-portable.exe` | Just run it. Tells you when there's a new version, but you download it yourself. |

You also need [Ollama](https://ollama.com/download) and the model:

```
ollama pull qwen3:8b
```

Relay tells you if either one is missing.

## Shortcuts

| | |
|---|---|
| `Ctrl Alt 1` `2` `3` | Auto translate to Korean / Japanese / French |
| `Ctrl Alt 0` | Auto translate off |
| `Ctrl Alt H` | Highlight to read |
| `Ctrl Alt K` `J` `F` | Translate the current draft once |
| `Ctrl Alt E` | Read what's selected |
| `Ctrl Alt T` | Open Relay |

## Free or paid

Ollama is the default and it's free. Runs on your GPU, nothing leaves the
machine, and Relay drops the model out of VRAM when you close it.

If you want it sharper, paste an Anthropic key on the Engine page instead — a
few dollars a month at normal use. The key is saved on your machine and never
shown again once you save it.

## Running from source

Needs Node 26, AutoHotkey v2 and Ollama.

```
npm install
npm start
```

That starts the translation service and the hotkey helper on its own.

## Building

```
npm run build
```

Both builds land in `dist`. `npm test` covers the pipeline and the app's own
flows; `npm run test:release` checks the packaged service actually boots.

Publishing a version needs `gh auth login`:

```
npm version patch
npm run release
```

## How the translation part works

Most of the quality lives in **`src/examples.js`** — example pairs sent as real
conversation turns. Those do far more than prompt rules do. When something comes
out wrong, the fix is almost always a new pair in there rather than more
instructions.

**`src/languages.js`** has the register rules and the Discord/gaming vocabulary
(`the call` means voice chat, not a phone call).

**`src/sanitize.js`** handles the things the model gets wrong often enough that
asking nicely isn't good enough — romaji `w` instead of 笑, invented emoji,
questions coming back as statements, French negation getting dropped so
"je sais pas" comes back as "I know".

**`src/detect.js`** decides what language something already is. Worth knowing
that it matters: if it guesses wrong, the translation gets skipped entirely and
the message goes out untouched.

`npm test` covers all of that plus the app's own flows — the control channel
between the window and the hotkey helper, saving settings, and the API key never
leaking back to the renderer.
