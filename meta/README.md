# Metadata relay

A small Cloudflare Worker that asks [TheTVDB](https://thetvdb.com) about TV shows for every TiviBro, so a show's poster, backdrop, logo art, summary and episodes come without a TMDB token.  The TV's helper calls it (`service/tvdb.js`); the address is in `service/tvdb.js` and can be changed there.

- Live at `https://tivibro-meta.theboxmod.workers.dev` (`GET /` says whether it is ready).
- `GET /v1/search?q=&year=&lang=`, `GET /v1/series/<id>?lang=`, `GET /v1/series/<id>/season/<n>?lang=`.  The answers are described at the top of `worker.js`.
- The secret `TVDB_KEY` is TiviBro's project key from TheTVDB (free for projects that make no money, with attribution).  Set it with `npx wrangler secret put TVDB_KEY`; it never goes in the repo.
- Answers are kept in Cloudflare's edge cache (search a week, a show 3 days, episodes a day), so most asks never reach TheTVDB.  Nothing about who asked is stored, and invocation logs are off.
- Deploy from this folder with `npx wrangler deploy`.
- Metadata provided by TheTVDB.  Please consider adding missing information or [subscribing](https://thetvdb.com/subscribe).
