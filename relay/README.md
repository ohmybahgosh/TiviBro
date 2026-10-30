# Report relay

A small Cloudflare Worker that lets people send **Report a problem** from the web editor without a GitHub account.  The editor's **Send report** button reads the relay's address from `https://tivibro.app/relay.json` (in `site/`), posts the report, and the relay opens an issue on this repo labelled `bug`, `triage` and `from-tv`, with the log folded under "Full log".

- Live at `https://tivibro-report.theboxmod.workers.dev` (`GET /` says whether it is ready).
- Settings: `REPO` (text), `RATE` (KV namespace `tivibro-report-limits`, for the limits), and the secret `GITHUB_TOKEN`: a fine-grained token for this repo only with **Issues: read and write**.
- It masks logins and server names again (the TV already did), caps every field, breaks @mentions, and allows 5 reports an hour per network and 60 a day in all.  It stores nothing but those counters (a hash of the address, for an hour or a day), and the Worker's invocation logs are off.
- Deploy from this folder with `npx wrangler deploy`; set the token with `npx wrangler secret put GITHUB_TOKEN`.  To move the relay, change `site/relay.json`: the editor follows it without a new release.
- If the relay is down or out of its daily allowance, the page says so and the GitHub form still works.
