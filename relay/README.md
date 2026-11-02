# Report relay

A small Cloudflare Worker that lets people send **Report a problem** from the web editor without a GitHub account.  The editor's **Send report** button reads the relay's address from `https://tivibro.app/relay.json` (in `site/`), posts the report, and the relay opens an issue on this repo labelled `bug`, `triage` and `from-tv`, with the log folded under "Full log".

- Live at `https://tivibro-report.theboxmod.workers.dev` (`GET /` says whether it is ready).
- Settings: `REPO` (text), `RATE` (KV namespace `tivibro-report-limits`, for the limits), and the secret `GITHUB_TOKEN`: a fine-grained token for this repo only with **Issues: read and write**.
- It masks logins and server names again (the TV already did), caps every field, breaks @mentions, and allows 5 reports an hour per network and 60 a day in all.  It stores nothing but those counters (a hash of the address, for an hour or a day), and the Worker's invocation logs are off.
- Deploy from this folder with `npx wrangler deploy`; set the token with `npx wrangler secret put GITHUB_TOKEN`.  To move the relay, change `site/relay.json`: the editor follows it without a new release.
- If the relay is down or out of its daily allowance, the page says so and the GitHub form still works.

## Following reports up

- `/report` also answers a `key` for the new issue (an HMAC of its number, signed with the secret `REPORT_KEY`, or the GitHub token if that isn't set).  The TV keeps it.
- `GET /status?n=24,25`: for issues the relay opened (label `from-tv`), open or closed, the newest comment by the repo's owner or members (as plain text), and the newest TiviBro version those comments name.  Answers are cached for five minutes.  TiviBro asks every few hours and shows a reply once (`app/js/reports.js`).
- `POST /followup` `{ n, key, what, version, tv, log }`: **Still happening** on the TV.  Needs that issue's key, masks the log again, shares the report limits, adds a comment and reopens the issue if it was closed.  The relay's own comments carry `<!-- tivibro-followup -->`, so they never count as a reply from the developer.
- Set the signing secret once: `openssl rand -hex 32 | npx wrangler secret put REPORT_KEY`.  Changing it later means older reports can no longer be followed up from the TV (they can on GitHub).

## Install numbers and the stats dashboard

- `POST /count` `{ e: install | update | active, v, w }`: the install script and TiviBro (once a day) count themselves.  Each network counts once a day per kind (a hash of the address, kept two days); only the day's totals by kind, version and webOS version are stored, in the `STATS` KV namespace.
- `POST /stats/github`: the Stats workflow (`.github/workflows/stats.yml`, `scripts/stats/collect.js`) stores the day's GitHub numbers every morning.
- `GET /stats?days=N`: everything, for tivibro.app/stats.  Both need the secret `STATS_KEY` (`npx wrangler secret put STATS_KEY`), also kept as the repo secret `TB_STATS_KEY`.
- The workflow also needs the repo secret `TB_STATS_TOKEN`: a fine-grained token for this repo with **Administration: read** (GitHub's traffic numbers need it), nothing else.
