# Contributing to TiviBro

Thanks for helping.  Bug reports, ideas, docs fixes and code are all welcome.

## Reporting a problem

Use [New issue](https://github.com/ohmybahgosh/TiviBro/issues/new/choose) and pick the form that fits: something doesn't work, channels/streams/guide, installing or updating, a question, or docs.  Ideas and feature requests go to [Discussions > Ideas](https://github.com/ohmybahgosh/TiviBro/discussions/categories/ideas).

- **Never post your provider's address, username, password or a stream link**, in the text, a log or a screenshot.  TiviBro masks logins in its own log, but check anyway.
- Include the TiviBro version (Settings > Updates and about) and your TV model and webOS version.
- For playback problems, run **Settings > Diagnostics > Run connection test** first and include the result.
- A phone photo of the TV screen is a perfectly good screenshot.

TiviBro doesn't provide channels, streams or playlists, so we can't help with a provider's content, prices or accounts.

## Working on the code

TiviBro is plain HTML, CSS and JavaScript with no bundler.  Start with the [README's Develop section](README.md#develop) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```bash
npm install          # the webOS CLI and test tools
npm run serve        # the app in a desktop browser at http://localhost:8078, with the dev relay
npm run lint
npm test
```

`node tests/mock/mock_provider.js` runs a made-up Xtream Codes provider for testing (`MOCK_EVENTS=1` adds event channels, East and West feeds and local stations).  The `tests/soak/` scripts drive the app and the web editor in a real browser; `bash tests/engines/run.sh` runs the app on the browser and Node versions of old TVs.

**Working with an AI assistant?**  Give it the knowledge base first: [tivibro-for-ai.md](https://tivibro.app/ai/tivibro-for-ai.md) (download it and attach it to Claude, ChatGPT or Gemini, or run `npm run ai` in your clone).  It has the rules below, what every source file does, the settings, the remote actions and how to test, so the assistant writes changes that fit.  Coding agents read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) by themselves.  [docs/ai/GUIDE.md](docs/ai/GUIDE.md) explains how to use it.

Ground rules:

- **Old TVs matter.**  The same IPK runs on webOS 4 (Chromium 53, Node 0.12 for the service).  No CSS grid, no Unicode property classes (`\p{L}`) in app regular expressions, ES5-style code in the service.  See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- **The remote first.**  Everything has to work with arrows, OK and Back, and with the Magic Remote.  Back always goes up one level.
- **Speed and stability over flash.**  Lists stay fast with 15,000 channels; nothing should slow down a channel starting.
- **Never lose the user's work.**  Edits are overlays on the provider's list; anything destructive asks first or can be undone.
- **Shared code stays shared.**  `app/js/names.js` and `app/js/tidy.js` are copied into `service/editor/` by `npm run build`; lint fails if they differ.
- **No secrets in the repository.**  Real provider tests read logins from a file outside the repo (see `tests/real/xc.js`).
- **Comment what you write.**  A function of 20 lines or more gets a comment above it saying what it does; `npm run lint` checks.
- **Write for viewers.**  Plain words in the UI and docs, and a line in CHANGELOG.md under "## Unreleased" for anything they'd notice.

Open a pull request against `main`; the template lists what to check.  Don't target the `homebrew` branch: it only holds the files the Homebrew Channel and the installer read, and the release workflow writes it.

## Translations

The TV loads only the dictionary of the language it shows, and one a phone or the web editor asks in, when it's needed (`I18n.boot`, `I18n.need` in `app/js/i18n.js`).  `app/js/lang/keys.js` lists every text the TV translates (as hashes), for telling TiviBro's own words from names; `i18n-import.js` rewrites it, and `npm test` says when it's out of date (`node scripts/i18n-keys.js`).

English is the key: each language's dictionaries map an English text to its translation, and anything not translated yet shows in English.  Two sets, one per part:

- `app/js/lang/<code>.js`: the TV app.  Text goes through `I18n.t` (Settings rows, menus, boxes, toasts and hints already do, so new code there needs nothing extra).
- `service/editor/lang/<code>.js`: the web editor (`tr('...')`, `trn(n, 'one', 'many')`, fixed page text translated as it's drawn, `data-raw` for names) and the phone app (`tr("...")`, `trn(...)` in Kotlin).  What the TV sends them (Settings pages, webedit.js messages written with `M('...')`, `MN(...)`, `fail('...')`) comes back in their language.

`{n}` is a number and `{x}` `{y}` `{z}` any text; a list is the plural forms of `{n}`.  `app/js/i18n.js` explains patterns, plural rules and variants (Spain's Spanish made from the Latin American one with words swapped).

**Every change ships translated.**  `npm test` fails while any language is missing a text, in any part.  After adding text:

1. `node scripts/i18n-todo.js <code> > todo.json`: what's missing in one language, across all three parts, with the rules and the glossary's words for each text.  (A text one part already has is copied to the other first.)
2. Translate it: by hand, or `ANTHROPIC_API_KEY=... node scripts/i18n-fill.js <code>`, which does it with Claude (the Message Batches API at half price, the shared rules and glossary prompt-cached) and checks each answer.  `node scripts/i18n-fill.js --test` shows which key is set, its organization and its models.
3. `node scripts/i18n-import.js <code> done.json`: checks each translation (placeholders, HTML tags, plural forms, no em dash) and writes it where the text shows.  `--replace` fixes a text already translated.

`npm run i18n` shows how far each language is.

**A new language:** `node scripts/i18n-add-lang.js de Deutsch German one` (its code, its own name, its English name, its plural rule: `one`, `fr`, `pt`, `ru` or `pl`; `--from es` for a variant).  It adds it to `i18n/langs.json`, the one list of languages, and `scripts/i18n-langs.js` writes that list into the TV app, the web editor and the phone app.  Then fill it as above.

**Words that stay the same:** `i18n/glossary.json` lists TiviBro's own words (Guide, Catch-up, Send to TV...).  Each language's word for one is whatever its dictionary says, the todo file puts the ones a language lacks first, and every text gets the words it uses, so a term is translated the same way everywhere.

**Checking the result:** `node tests/soak/i18n-layout.js --shots dir` draws every TV screen in each language and fails on text that's cut off or overlapping; `node tests/soak/editor-i18n.js de` opens every web editor page in a language.  Native speakers fixing wording: a pull request on the dictionary file is welcome (data only: JSON-style keys and values).

## Releases

Maintainers cut releases with `npm run release -- alpha.N` after moving "## Unreleased" in CHANGELOG.md under a version heading.  GitHub Actions builds the IPK, publishes the release, updates the Homebrew Channel repository and the website.

## Code of conduct

Be kind.  See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
