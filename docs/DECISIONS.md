# Decisions

- **Name and IDs:** TiviBro, `app.tivibro.tv`.  No personal domain anywhere in the app.  No "webOS" or "LG" in the name (LG trademarks).
- **Stack:** plain JS + hls.js (full build, for separate audio tracks and subtitles) + mpegts.js, no framework, no bundler.  Keeps cold start fast on slow TV CPUs and avoids module-script issues under `file://`.
- **Playlists at launch:** Xtream Codes or manual M3U + XMLTV only, per-playlist guide sources and TiviMate-style refresh intervals.  Stalker deferred.
- **Must-haves before launch:** remote button remapping; solid channel name editor with preloaded defaults and "Enable recommended defaults".
- **Buffering first:** buffer profiles (Fast zapping, Balanced, Smooth, Rock solid, Custom), refill-to-cushion on underrun, stall watchdog, reconnect with backoff.
- **CORS:** bundled localhost helper service rather than requiring provider CORS.  Network setting Automatic/Direct as an escape hatch, reachable from the setup screen.
- **HTTPS:** accept self-signed certs in the helper; auto-detect scheme when omitted; portless servers are normal.
- **requiredACG omitted** on purpose: enforced only from webOS 26, and adding it on 25 and below switches permission checks on.
- **Credentials** are masked in every log and on screen.
