# Report relay

A small Cloudflare Worker that lets people send **Report a problem** from the web editor without a GitHub account.  The editor's **Send report** button reads the relay's address from `https://tivibro.app/relay.json` (in `site/`), posts the report, and the relay opens an issue on this repo labelled `bug`, `triage` and `from-tv`, with the log folded under "Full log".

- Live at `https://tivibro-report.theboxmod.workers.dev` (`GET /` says whether it is ready).
- Settings: `REPO` (text), `RATE` (KV namespace `tivibro-report-limits`, for the limits), and the secret `GITHUB_TOKEN`: a fine-grained token for this repo only with **Issues: read and write**.
- It masks logins and server names again (the TV already did), caps every field, breaks @mentions, and allows 5 reports an hour per network and 60 a day in all.  It stores nothing but those counters (a hash of the address, for an hour or a day), and the Worker's invocation logs are off.
- Deploy from this folder with `npx wrangler deploy`; set the token with `npx wrangler secret put GITHUB_TOKEN`.  To move the relay, change `site/relay.json`: the editor follows it without a new release.
- If the relay is down or out of its daily allowance, the page says so and the GitHub form still works.

## Install numbers and the stats dashboard

- `POST /count` `{ e: install | update | active, v, w }`: the install script and TiviBro (once a day) count themselves.  Each network counts once a day per kind (a hash of the address, kept two days); only the day's totals by kind, version and webOS version are stored, in the `STATS` KV namespace.
- `POST /stats/github`: the Stats workflow (`.github/workflows/stats.yml`, `scripts/stats/collect.js`) stores the day's GitHub numbers every morning.
- `GET /stats?days=N`: everything, for tivibro.app/stats.  Both need the secret `STATS_KEY` (`npx wrangler secret put STATS_KEY`), also kept as the repo secret `TB_STATS_KEY`.
- The workflow also needs the repo secret `TB_STATS_TOKEN`: a fine-grained token for this repo with **Administration: read** (GitHub's traffic numbers need it), nothing else.
