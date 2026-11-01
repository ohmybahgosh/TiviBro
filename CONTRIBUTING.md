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
- **Write for viewers.**  Plain words in the UI and docs, and a line in CHANGELOG.md under "## Unreleased" for anything they'd notice.

Open a pull request against `main`; the template lists what to check.  Don't target the `homebrew` branch: it only holds the files the Homebrew Channel and the installer read, and the release workflow writes it.

## Releases

Maintainers cut releases with `npm run release -- alpha.N` after moving "## Unreleased" in CHANGELOG.md under a version heading.  GitHub Actions builds the IPK, publishes the release, updates the Homebrew Channel repository and the website.

## Code of conduct

Be kind.  See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
