# AGENTS.md

Instructions for AI coding agents (Codex, Cursor, Copilot, Claude Code and others) working in this repository.

**Read [docs/ai/GUIDE.md](docs/ai/GUIDE.md) before changing anything.**  It has the rules, where each kind of change goes, and how to test.  For the whole picture in one file (every source file's purpose, settings, remote actions, tests, compatibility), run `npm run ai` and read `tivibro-for-ai.md`, or download the newest copy from <https://tivibro.app/ai/tivibro-for-ai.md>.

The short version:

- App code (`app/js/`) must run on Chromium 53 (webOS 4): no `async`/`await`, object spread, `?.`, `??`, CSS grid or `\p{}` regex classes.  The helper (`service/`) is plain ES5 for Node 0.12.
- Works with the TV remote alone: arrows, OK, Back.  Back goes up one level.
- Never put provider addresses, logins or stream links in code, tests, fixtures or logs.  Test with `tests/mock/mock_provider.js`.
- Nothing starts playing by itself.  No new tracking or remote calls.
- Edit `app/js/names.js`, `tidy.js`, `pubepg.js` and `links.js`, never their copies in `service/editor/` (`npm run build` copies them).
- Edit `docs/USER-GUIDE.md`, never `docs/wiki/` (generated).
- Text people read: plain words, two spaces between sentences, no em dashes.
- Before you finish: `npm run lint` and `npm test` pass, a test covers the change, `CHANGELOG.md` has a line under `## Unreleased` with a bold headline, and the user guide covers new settings or screens.
- Don't bump versions, edit release notes or the `homebrew` branch, or cut releases.
