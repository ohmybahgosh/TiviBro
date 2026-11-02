# My media: complete movies and TV-show build

Status: implementation specification, not implemented code.  Revised 2 November 2026 after review of the existing app.  This supersedes the earlier staged-release plan.  The user wants all the features below in the same build, including metadata.  Implementation milestones are dependencies, not separate releases or permission to drop scope.

Read this with [the acceptance tests](acceptance.md) and [the implementation handoff](handoff.md).  If an implementation choice conflicts with an invariant here, fix the choice or report the concrete conflict.  Do not quietly replace a feature with a placeholder.

## 1. Outcome and complete scope

A viewer can add a WebDAV or DLNA source containing movies, shows, or both, in any combination of root files, nested folders and per-title folders.  My media discovers the files, separates Movies and TV shows, groups shows into seasons or their actual numbering scheme, enriches them with optional metadata, remembers viewing progress, and plays subsequent episodes when enabled.  Everything works with the TV remote.  Android can browse and play the same library on the TV.  The web editor makes bulk corrections practical.

This build includes all the features previously excluded or postponed:

| Area | Required in this build |
| --- | --- |
| Discovery | Recursive mixed-layout scanning, source modes, exclusions, resumable scans, large-library support, DLNA view deduplication |
| Classification | Season/episode names, specials, multi-episode files, date-based shows, absolute anime numbering, server evidence, ambiguity review |
| Identity | Persistent show/episode identities, alternate versions, deliberate cross-source grouping, merge/unmerge, rename/relink workflows |
| Metadata | TMDB movie/show/season/episode details, posters, backdrops, logos and episode stills where available, language fallback, match correction, caching |
| TV interface | Movies and TV shows, seasons/episodes, search, favourites, Continue watching, watched state, source/version indicators, all correction controls |
| Playback | Resume, next-episode preview and auto-next, specials policy, missing episodes, version selection, authenticated WebDAV and signed-link resolution |
| Multi-episode media | Chapter inspection for supported MKV/MP4 chapter forms, explicit boundary mapping, remote/manual timestamp editing, safe full-file playback otherwise |
| Other interfaces | Android show/episode browsing and Play on TV; web editor bulk classification, matching, merge/relink and boundary editing |
| Delivery | Migration, rollback recovery, tests, old-engine compatibility, user guide, changelog, combined build and actual-device verification |

Optional metadata means the viewer can use the feature without a TMDB credential.  It does not mean metadata implementation is optional.  Likewise, unsupported or ambiguous media must have a working correction/fallback workflow in this build; do not claim that arbitrary files can be identified with certainty.

Out of scope: building a new transcoder, downloading subtitles from a new service, synchronising watch history with external accounts, adding SMB/NFS/Plex/Jellyfin source types, changing provider Movies/Shows data, and implementing a general Matroska ordered-edition playback engine.  Preserve existing subtitle and WebDAV contributions throughout this work.  Normal chapter extraction and manual episode boundaries are in scope.

## 2. Verified starting point

The reviewed combined checkout is `/Users/moritz/lg-tv/tivibro-latest`, branch `media-subtitle-formats`, reviewed at `d1e7110`.  Recheck HEAD and worktree status before implementation.  Do not assume this branch contains the guide-message contribution or the latest upstream commits.

Existing behaviour:

- `service/media.js` already reads source-root files and recurses into children for both WebDAV and DLNA.  No recursion toggle is needed to make flat/mixed libraries work.
- Recognised episodes and season folders are intentionally skipped.  DLNA also skips TV/Series views.  Unrecognised episode names can leak into movies.
- Scan queues retain immediate folder names, not the full ancestry needed by `Show/Season 1/Episode 02.mkv`.
- `titleOf` can replace a filename with a `Title (Year)` parent name.  The small-file heuristic in a year-bearing folder can wrongly treat a collection as one film with extras.  Fix both while preserving real movie-folder behaviour.
- Current limits are 120 seconds per scan, depth 12, 3,000 folders, DLNA pages of 200, and a 16 MiB response cap.  There is no persistent traversal cursor.  `browseAll` can accumulate an entire DLNA folder.
- Current raw WebDAV IDs derive from paths; DLNA IDs derive from resource URL paths.  `MediaStore` prefixes them with the source ID.  A path-derived ID is not proof of stable identity across a rename.
- `app/js/mediastore.js` stores the library in `media:lib` and small state in `tivibro.media`.  It merges partial scans, protects old entries on empty scans, and copies old metadata without checking the new content type.
- Resume records are removed near completion.  There is no independent watched record.  An absent resume is not evidence of having watched an episode.
- `Media.ended` currently returns to My media.  Provider-series auto-next in `vod.js` does not implement My media auto-next.
- `service/media-metadata.js` currently implements movie TMDB lookup.  Existing user credentials and language preferences must be reused.
- Phone requests with `kind: "media"` currently mean movies.  Android provider-show models exist, but My media needs an additive, paginated contract.

Current tests already exercise flat DLNA, nested movie folders, mixed root/folder WebDAV libraries and DLNA pagination.  Retain them and add the cases in the companion test document.

## 3. Non-negotiable invariants

1. A file remains reachable even when its classification or metadata is uncertain.
2. Reclassification, display-language changes, matching, and refreshing metadata do not change physical file identity or discard progress.
3. Physical files, logical episodes, shows, and metadata matches have different identities.
4. The same media bytes exposed through duplicate DLNA views are not alternate encodes.  Two different encodes remain selectable versions.
5. Partial, failed, cancelled, filtered, or stale scans cannot delete saved content/history.
6. A scan never starts playback or makes an unrequested external metadata lookup.
7. Auto-next belongs to the active playback session.  Stop, Back, source removal, another Play action, or navigating away cancels its pending work.
8. A metadata-only episode is never presented as a playable local file.
9. Ambiguous evidence is shown as uncertainty, never disguised as a confident match.
10. No source credentials, signed URLs, helper session tokens, or raw credential-bearing paths appear in logs, phone/editor responses, screenshots or checked-in fixtures.
11. All controls have arrows/OK/Back equivalents.  Back restores the previous selection and scroll position.
12. A large library is stored and queried in the helper.  Do not migrate the whole catalogue into a browser array and call the result paginated.

## 4. Architecture and ownership

Keep the existing no-framework architecture.  New names below are proposed files, not files that already exist.  Read current route and script-loading conventions before wiring them in.

| Layer / file | Responsibility |
| --- | --- |
| Existing `service/media.js` | WebDAV/DLNA adapters, traversal jobs, source resolution, dispatch to library/classification modules |
| New `service/media-classify.js` | Pure ES5 parsing and evidence resolution; no filesystem or network access |
| New `service/media-library.js` | Versioned durable records, migration, indexes, query, transaction/revision handling, grouping and overlays |
| New `service/media-chapters.js` | Bounded chapter inspection and validated physical-timeline boundaries |
| Existing `service/media-metadata.js` | Typed TMDB search/detail/season/episode/order operations and cache policy |
| Existing `service/proxy.js` | Protect all new library/control routes with the existing helper secret |
| Existing `service/kv.js` | Reuse its persistent storage root and atomic-write conventions; do not put the library in `/tmp` |
| Existing `app/js/mediastore.js` | Small-state facade, migration orchestration, query cache, optimistic commands with confirmed revisions |
| New `app/js/media-series.js` | Show/season/episode screens, correction dialogs, focus restoration |
| New `app/js/media-queue.js` | Pure next-item ordering plus playback-session state machine |
| Existing `app/js/media.js` | My media shelves, source actions, player integration, phone adapters |
| Existing `app/js/views.js`, `player.js`, `subs.js`, `mkvsubs.js` | Preserve common playback/seek/subtitle lifecycle; change only necessary integration points |
| Existing `app/js/settings.js`, `store.js`, app HTML/CSS | Preferences, source controls, script order, remote UI styling |
| Existing `app/js/webedit.js`, `service/editor/index.html` | Editor commands and bulk correction UI |
| Existing `app/js/phone.js`, `service/companion.js`, Android protocol/UI | Capability negotiation, paginated My media series API and screens |

Do not clone provider-series playback code wholesale.  Reuse visual/navigation conventions, but My media resolves source files through its own store and resolver.  Keep classification and queue ordering independently testable.

All helper code is Node 0.12-compatible ES5.  App code must run on Chromium 53.  No new native dependency, SQLite runtime, transcoder or modern-only library is assumed.  Kotlin remains in the Android build pipeline.

## 5. Data contract

Use schema version 2.  Public JSON examples use readable names.  Internal compaction is allowed only behind documented serializers and round-trip tests.  Integers representing seconds are not confused with milliseconds; playback/boundaries use seconds, timestamps use UTC epoch milliseconds, air dates remain calendar-date strings.

### 5.1 Records

| Record | Primary key and fields |
| --- | --- |
| Source preferences | Existing source ID; `contentMode`, `discoveryEnabled`, `excludeRules`, `defaultOrder`, `preferredSourceRank`, `configRevision`.  Credentials remain in the existing protected source configuration. |
| File | Existing full `fileId` for migrated files; `sourceId`, protected locator, observed identity evidence, `basename`, ancestry, size, extension, modification marker, classification, availability, `addedAt`, `lastSeenGeneration`, `revision` |
| Show | Persistent random opaque `showId`; local/display title, original title, year when known, identity anchors, source membership, selected episode order, metadata reference, favourite, merge history, revision |
| Episode | Persistent opaque `episodeId`; show ID, local number/date/absolute identity, canonical number if mapped, title, file memberships, metadata reference, watched record, revision |
| Membership | `fileId`, `episodeId`, optional `startSec`/`endSec`, boundary provenance and content fingerprint; one file can cover multiple episodes and one episode can have several files |
| Overrides | Target file/folder/show, overridden fields, explicit exclusions, mapping/order, creator `user`, revision; never overwritten by scanning |
| File progress | `fileId`, position/duration in seconds, `updatedAt`, playback session ID, completed flag; one physical timeline per file |
| Episode watch state | `episodeId`, state `unwatched`/`inProgress`/`watched`, completion time, provenance `playback`/`manual`; explicit manual reset wins over older events |
| Metadata | Typed key, locale, fields and provenance, fetched time, stale time, match method, negative/error cache status; raw provider data is not the local file identity |
| Scan job | Job ID, source/config revision, source scope, parser version, generation, persisted frontier/visited/page cursors, counts, errors and terminal/paused status |

A movie can retain its existing file-based favourite/resume behaviour.  Shows have independent favourites.  Series watched state is derived from owned episodes; never mark unavailable metadata episodes watched as a side effect.

Example of one file covering two logical episodes:

```json
{
  "schema": 2,
  "file": {
    "fileId": "src_demo|w:/Shows/Harbour/Harbour.S01E01E02.mkv",
    "sourceId": "src_demo",
    "kind": "episode",
    "availability": "available",
    "episodeIds": ["ep_demo_1", "ep_demo_2"],
    "revision": 4
  },
  "show": {
    "showId": "show_demo",
    "localTitle": "Harbour",
    "order": "aired",
    "metadataKey": "tmdb:tv:900001"
  },
  "episodes": [
    {"episodeId": "ep_demo_1", "showId": "show_demo", "season": 1, "number": 1},
    {"episodeId": "ep_demo_2", "showId": "show_demo", "season": 1, "number": 2}
  ],
  "memberships": [
    {"fileId": "src_demo|w:/Shows/Harbour/Harbour.S01E01E02.mkv", "episodeId": "ep_demo_1", "startSec": 0, "endSec": 1420, "boundaryOrigin": "user"},
    {"fileId": "src_demo|w:/Shows/Harbour/Harbour.S01E01E02.mkv", "episodeId": "ep_demo_2", "startSec": 1420, "endSec": null, "boundaryOrigin": "user"}
  ]
}
```

These are synthetic identifiers.  File IDs may contain private paths; public clients receive opaque handles instead.  A membership with unknown boundaries has both times null.  The final segment can have a known start and null end until duration is known.

### 5.2 Identity, duplicates, versions and relinking

- Preserve existing `sourceId|rawId` for migrated files even if the new locator canonicalisation improves.  Maintain locator aliases to find the old record.  Do not globally re-key old libraries.
- Canonicalise WebDAV paths once, respecting case and encoded separators.  Resolve relative hrefs against the configured root; reject traversal outside that root.  Do not repeatedly decode percent escapes.
- Scope DLNA object IDs to the device/source.  Preserve its canonical resource identity and all discovered parent contexts.  Resource query parameters can distinguish files: do not strip arbitrary parameters to force deduplication.  Remove only source-adapter parameters explicitly proven to be expiring transport tokens.
- If old DLNA path-only IDs collide for genuinely different resources, retain the old file ID for the existing record and mint a collision-safe ID for the newcomer.  Put uncertain history ownership in review; do not copy progress to both.
- Two views referencing the same validated resource/object identity become one file with several ancestry observations.  Different resources for the same episode become versions.  Neither deduplication nor version grouping uses size alone.
- New show IDs and episode IDs are opaque and persistent.  Matching TMDB adds an identity anchor; it does not replace local IDs.  Number/date corrections update coordinates while preserving the episode ID where the content identity is unchanged.
- Within a source, a show-folder anchor groups its descendants.  A flat explicit show name can join exactly one compatible existing show with matching normalised title and non-conflicting year/order.  Multiple candidates go to review.  Separate same-name folders are separate until stronger evidence or an explicit merge resolves them.
- Across sources, automatic merge requires the same confirmed typed TMDB TV ID and compatible episode-order mapping, or a saved user merge rule.  Title alone never suffices.  Keep original source/version membership after merging.
- On merge, choose the oldest created show as survivor unless the user selected a target.  Alias old show/episode IDs to surviving IDs.  Preserve per-file progress; combine compatible episode watched states by latest explicit event.  Show conflicts in preview, especially contradictory manual mappings.
- Persist a merge operation record containing prior memberships, aliases, metadata and override revisions.  Unmerge restores the source groups and their file progress.  If intervening edits cannot be assigned safely, preview those conflicts instead of silently reverting them.  For an episode shared by both groups, a post-merge manual watch event applies to both on split; file-derived watch evidence follows its file.
- Renames/moves: automatically relink only when a source adapter supplies a stable file identifier with tested persistence semantics.  ETag, byte size, filename similarity and a DLNA URL alone are not such a guarantee.  Otherwise offer Locate file: select the missing record, select a discovered replacement, preview progress/metadata transfer, then save an alias transaction.  Conflicting existing histories require an explicit choice.  Keep an undo record.

## 6. Durable storage, migration and query

### 6.1 Storage implementation

Implement helper-owned, paginated storage without introducing a database dependency.  Use immutable JSON pages and an atomic manifest under the persistent root from `kv.js`.  A page contains at most 256 records or 1 MiB, whichever comes first.  Large field values are bounded at ingest.  Keep files, episodes, shows, overlays, progress and metadata in separate page families.

The manifest contains schema version, library revision, active generation, source scan summaries, index descriptors and references to immutable pages.  Indexes cover source, show, season/order bucket, content kind, review state and display sort.  An ID index maps record IDs to pages; do not keep a full record catalogue in the browser.  Page/index construction uses bounded runs and a merge pass, not one `JSON.parse` of the entire catalogue.  Use bucketed ID indexes and a small LRU of pages in the helper; choose a fixed 8 MiB page cache initially and measure it.

Serialize library mutations through one writer.  A transaction writes changed pages and indexes to temporary names, validates them, renames immutable files into place, then atomically replaces the manifest last.  Retain the previous valid manifest and its referenced pages.  On startup choose the latest fully valid committed generation; remove only unreferenced abandoned temporary data after recovery.  Flush writes before acknowledgement; use `fs.fsync` where the target runtime supports it.  Fault-injection tests must validate each commit boundary.  Report ENOSPC without corrupting the committed generation.

Scan observations are staged, then applied against the current overrides/history, not a stale whole-library snapshot taken at scan start.  Metadata updates and user edits use field ownership plus revisions.  A late response cannot revert a manual match or override made after it began.

### 6.2 Migration

1. Read existing source state, `media:lib`, favourites, metadata and resume records without changing them.  Obtain schema/migration status from the helper before choosing v1 or v2 readers.
2. Create a durable migration snapshot and a v2 staging generation.  Stream the old JSON array with a bounded tokenizer; no full legacy catalogue round-trip through the app.  The app sends only its small legacy state if the helper does not already own it.
3. Preserve file IDs, added dates, favourites, source IDs and valid resume positions exactly.  Old entries with no kind become movies.  Missing resume data becomes unknown/unwatched, never watched.
4. Store legacy `tmdb:<id>` data as movie-typed metadata with `matchOrigin: legacyUnknown`.  Do not guess it was manually selected.  If reclassification makes it incompatible, retain it in recoverable legacy metadata and show a review reason; do not attach movie fields to an episode.
5. Build indexes, verify counts and references, then commit manifest.  Re-running migration is idempotent; restart from a valid staging checkpoint or rebuild, never duplicate records.
6. Only after acknowledgement switch the app facade to v2.  Keep the original snapshot until a documented cleanup action after successful use.  Existing sources remain Movies only until the viewer enables show discovery; show an actionable one-time notice, not a blocking wizard.
7. If helper storage is unavailable, preserve the v1 movie library and show that TV-show library setup needs storage.  Do not pretend migration succeeded or silently discard the large-library design.  A transient helper outage after migration shows cached visible rows with unavailable actions, not a second writable v1 library.

Rollback recovery restores the saved pre-migration snapshot.  New v2 edits do not magically exist in an older app; make this explicit in developer recovery documentation and retain the v2 generation for recovery.  Do not dual-write unrepresentable show data into v1.

### 6.3 Helper API contract

New routes are under existing protected `/media/`.  Below are proposed exact route names.  Use the HTTP methods in the table; POST query/detail routes carry structured read-only filters, while mutation routes require idempotency/revision checks.  All routes reuse the helper secret.  Phone/editor clients call their authenticated adapters, not these routes directly.

| Route | Request / response |
| --- | --- |
| `GET /media/library/status` | Schema, revision, capabilities, migration state, counts, source job summaries; no locators or credentials |
| `POST /media/library/migrate` | Small legacy state plus idempotency ID; asynchronous migration job acknowledgement |
| `POST /media/library/query` | Kind/shelf/source/show/order bucket/search, page cursor, limit; projected rows, next cursor, revision, total when known |
| `POST /media/library/detail` | Opaque entity handle; show with season summaries, movie, episode with versions, or review evidence.  Never every episode of a large show |
| `POST /media/library/edit` | Operation, target handles, expected revision, idempotency key, validated fields; committed revision or conflict |
| `POST /media/library/progress` | File handle, session ID, event sequence, position, duration, playback/seek/end event; deduplicated acknowledgement |
| `POST /media/scan/start` | Source reference/config supplied through existing protected app path, mode `resume`/`restart`, config revision; job ID |
| `POST /media/scan/status` | Job ID; counters, saved progress and sanitised scope errors |
| `POST /media/scan/cancel` | Job ID; persist frontier and pause; repeated calls safe |
| `POST /media/metadata/job` | Explicit search/match/refresh/batch action, target handles and locale; job/result |
| `POST /media/chapters/inspect` | File handle and protected resolver session; bounded inspection job/result, never raw URL in public result |

Query defaults: 60 rows; maximum 200; no more than three pages retained per open list in the app.  Cursors include query identity and library revision.  An obsolete cursor returns `STALE_CURSOR` with the new revision; the UI reloads around the focused item instead of appending duplicates.  Search uses a normalised helper index and preserves accents in display text.  A bounded scan of index pages is acceptable; loading all records for every keystroke is not.  Debounce search 250 ms and cancel obsolete responses.

Edits include `classifyFile`, `setFolderRule`, `resetOverride`, `setMatch`, `setOrder`, `mapEpisodes`, `mergeShows`, `unmergeShows`, `relinkFile`, `setBoundaries`, `setWatched`, `setFavourite`, `hideItem`, `restoreItem`.  Validate operation-specific fields, ownership and revisions.  Batch edits have a preview token tied to the revision, then an atomic commit.  Reject or recompute a stale preview; do not apply it to a changed selection.

Use stable error codes (`CONFLICT`, `STALE_CURSOR`, `SOURCE_OFFLINE`, `AUTH_REQUIRED`, `STORAGE_FULL`, `INVALID_MAPPING`, `CANCELLED`, `UNSUPPORTED_CHAPTERS`) and plain display messages.  Existing v1 movie clients keep their expected response shapes through adapters during migration/integration.

## 7. Discovery and scan lifecycle

### 7.1 Source controls

New sources default to **Movies and TV shows**.  Alternatives: **Movies only**, **TV shows only**.  Existing sources retain Movies only until discovery is enabled.  Modes filter classification/presentation; they cannot invent missing show/season evidence.  Recursion is on by default and works for root, folder and mixed files.

Advanced controls: excluded folders/patterns with preview; maximum depth (default 12, range 1–64); per-show order choice; Resume scan, Restart scan, and Review excluded items.  Increasing depth resumes previously limited scopes.  Do not introduce a required “recursive scan” switch.  A source mode/exclusion change increments `configRevision` and triggers reclassification/rescan as needed without treating excluded records as deleted.

Explicitly hidden/excluded items have separate state from missing files.  Keep their history and overrides.  Source removal offers recoverable removal of source records, with undo while retained locally; it never touches remote files.

### 7.2 Scanner result and adapter observations

Separate traversal observations from classification.  A source adapter emits file records containing source-scoped identity, locator, basename, ancestor chain, size/extension/modification evidence, validated server metadata and origin.  Traversal emits directories separately.  The classifier returns kind, fields, evidence, conflict/review reasons and candidate grouping anchors.

Stop pruning season/TV containers before traversal.  Continue to exclude confirmed Music/Pictures-only DLNA views, but allow video-bearing unknown/mixed containers.  Retain alternate-view context without repeatedly expanding cycles.

DLNA initially supports documented, fixture-backed `dc:title`, `upnp:class`, `upnp:seriesTitle`, `upnp:programTitle`, `upnp:episodeNumber` and date fields only when actually present and parsed by a strict adapter.  These fields are candidates, not a promise that all servers provide them.  A plain episode number does not imply season 1.  Vendor extensions require their own fixture and explicit namespace handling.  Server title is weaker than a conflicting explicit `SxxEyy` filename unless the server supplies structured, validated show/season/episode fields; that conflict still enters review.

### 7.3 Bounded, resumable jobs

- Queue entries include canonical folder/object identity, full ancestry, depth, current page offset/cursor and visited state.  Persist them in pages, not an unbounded in-memory queue.
- Default work slice stays 120 seconds or 3,000 folders, whichever comes first.  The job then checkpoints as `pausedBudget`; it is not marked complete.  A scan started by the user continues in subsequent slices while the app is active, subject to pause and playback priority.  Restarting the app does not automatically contact sources unless an existing user setting authorises that; offer Resume.
- Retain 8-second request deadlines and 16 MiB body cap initially.  DLNA processes pages of 200; check cancellation/deadline between pages.  Detect no-progress/repeated pages and cycles.  Cap individual directory pagination at 10,000 pages per pass and retain an explicit blocked scope if exceeded.
- WebDAV PROPFIND Depth 1 has no universal pagination.  A folder exceeding the response cap is a visible incomplete scope, not an empty successful folder.  Do not repeatedly retry it in an automatic loop.  Smaller subfolders or a server-supported adapter are actionable alternatives.
- Cap in-memory frontier at 500 entries; spill overflow to persistent pages.  A per-source 250,000-file guard stops with a visible limit and retained checkpoint; this is a protective bound, not a claim that larger libraries completed.
- Missing/failed folders, depth limits and duplicate loops are recorded by scope.  Authentication failure pauses the source and requests credential repair through the existing settings flow.  Do not log request headers or URLs.
- Discoveries can be committed in bounded batches for useful progress.  Only a successful complete authoritative traversal of the same configuration can mark unseen files missing.  This requires enumeration success in all relevant scopes and a current generation/config revision.
- Empty scans preserve old records and prompt Review source rather than marking the whole source missing.  A nonempty complete scan may mark unseen entries missing, retaining history and corrections.  It does not physically erase them.  Provide an explicit clean-up action with preview for missing records.
- Cancellation saves progress; source removal or configuration changes invalidate the old job token.  A delayed response cannot resurrect a removed source or publish under a new configuration.

A server may mutate while being scanned.  Treat scan membership as an observation, not a transactional snapshot of the server.  Restore a missing record immediately when its validated identity reappears; preserve its progress.

## 8. Classification rules

### 8.1 Evidence and conflicts

Precedence: explicit file override; most-specific applicable folder override; validated structured server fields; explicit filename tokens; ancestor context; unresolved candidate.  Metadata enriches or maps a recognised identity after a requested match; fuzzy metadata search does not secretly reclassify files during scanning.

Higher precedence fills missing fields.  Conflicting strong observations produce a review reason unless a user override deliberately resolves them.  Keep the lower-level evidence for reset/review.  Conflicting explicit filename and folder season numbers are not silently overridden.

Normalise separators and case for comparisons only; preserve original names.  Remove extension and known release/quality/audio tokens after parsing identity tokens.  Unicode letters must survive cleanup without modern regex property escapes.  Do not treat resolution (`1080`, `2160`), codec (`264`, `265`), audio (`5.1`), years, release-group checksums, or a bare trailing integer as an episode number without the rules below.

### 8.2 Season, special and multi-episode names

Recognise case-insensitive, token-delimited:

- `Show.S01E02`, `Show S1 E2`, `Show 1x02`.
- Repeated episode markers `S01E01E02`, ranges `S01E01-E03`, `1x01-03`; expand a same-season range only if ascending and at most 50 episodes.  Invalid/huge ranges go to review.
- `Show/Season 1/Episode 02`, `Show/Staffel 1/02 - Title`, and equivalent already-supported season-folder translations.  A bare number is allowed here only with an established show plus season-folder context and a non-release-token filename pattern.
- `S00E01` and numbered episodes under Specials become season 0.  An unnumbered special remains in a Specials/unassigned review group until numbered or deliberately kept as an unnumbered special with its own persistent identity.  Do not make up episode 0.
- Cross-season bundles require explicit mappings; the normal range parser must not invent transitions.

Multi-episode membership is logical, independent of whether file timestamps are available.  A row can say “Episodes 1–2, one file”.  Versions covering overlapping ranges must not double-count episodes in show progress.

### 8.3 Date-based episodes

Recognise an explicit show title/context plus `YYYY-MM-DD`, `YYYY.MM.DD` or `YYYY_MM_DD`, with calendar validation including leap years.  A standalone date/camera filename or movie release-date title is ambiguous and goes to review rather than automatically becoming a daily show.  Existing date-order folder rules and validated server episode dates are strong evidence.

Store `airDate: "2026-10-31"` as a date, not a timezone-converted timestamp.  Before a season mapping exists, show a year bucket (label “2026”), sort by date, and keep persistent episode IDs.  Two distinct files with the same date are candidate versions only if other identity evidence agrees; explicit part numbers create separate logical episodes.  Multiple metadata episodes on the same date require disambiguation, not selecting the first response.

When TMDB is matched, map exact unique air dates within verified fetched season data.  Do not assume calendar year equals season number.  Keep local date identity if mapping is missing.  Fetching metadata outside owned seasons requires an explicit mapping job with progress/cancel and bounded requests, not an unbounded background crawl.

### 8.4 Absolute/anime numbering

Support `Show - 057`, `Show EP057`, and release-group forms such as `[Group] Show - 057 [1080p]` when a saved Absolute order rule, validated server metadata, or the structured release pattern establishes episode intent.  A generic `Film 57.mkv` is not enough.  Without a reliable show/order context, suggest Absolute numbering in review.

Store positive `absoluteNumber` and optional numeric part, retaining zero-padded source labels only for display.  Unknown season is null, not 1.  Present an **Episodes** bucket ordered numerically until a verified mapping exists.  Decimal/special anime numbering (for example 12.5) is stored as a structured special label/order key, not rounded into episode 12; require explicit rule/review where ambiguous.

Per-show order choices: Aired, Absolute, Date, and a selected TMDB episode group/custom order.  Switching order changes display/mapping, not file identity or watched state.  TMDB aired episode numbers are not a global absolute sequence.  Fetch available episode groups, let the user choose a meaningful order, and map the selected group's entries explicitly.  If no useful group exists, provide a manual mapping table with bulk offset/range assignment, preview and undo.  Never generate a confident absolute mapping by concatenating seasons that happen to be returned.

### 8.5 Movies, extras and uncertain files

Use filenames by default for movies.  A `Title (Year)` folder supplies the title only when the contents support a single movie: one main candidate plus identifiable extras, or multiple clearly labelled versions of that same movie.  Several differently titled films keep their own names regardless of count/relative size.  A generic `video.mkv` in a one-movie folder may inherit its title.

Classify episodes before movie-specific extras rules.  Confirmed episodes under 100 MB remain episodes.  Explicit user inclusion beats automatic extra exclusion.  A clear `sample`/`trailer` subfolder or file can be hidden as an extra, but offer Review excluded items and inclusion.  Do not infer “extra” solely because a video is one quarter the size of another in a mixed collection.  Unknown small videos belong in review if the content cannot safely be determined.

Keep unsupported video extensions visible in source diagnostics; recognised containers retain existing playback capability checks.  Scanning a file is not proof that the TV can decode its audio/video codec.

## 9. Metadata: complete implementation

### 9.1 Consent, matching and endpoints

Reuse the viewer's existing TMDB credential, validation and language setting.  Keep credentials helper-side during requests and never send them to phone/editor.  No new metadata provider or bundled credential is introduced.  A scan uses local/server evidence only.  **Fetch details** on an item/source starts an explicit lookup job.  An optional **Fetch details for new items** setting may be enabled by the viewer; default off for both existing and new sources, with disclosure that title/year queries go to TMDB.  Record the setting/consent separately from merely having a token.

Implement typed operations: movie search/detail, TV search/detail, season detail, episode detail as needed, TV episode-group listing and selected group detail.  IMDb find results must choose the requested media type.  Ambiguous candidates display type, title/original title, first release/air year, poster and a short description.  An automatic match is allowed only for exactly one normalised exact-title candidate with compatible known year; no year plus several same-title shows means review.  Do not choose the highest popularity result as identity.

Use typed keys:

```text
tmdb:movie:<id>
tmdb:tv:<id>
tmdb:tv:<id>:season:<number>
tmdb:tv:<id>:season:<number>:episode:<number>
tmdb:tv:<id>:group:<groupId>
```

Fetch show details first, then only relevant owned seasons for normal enrichment.  A season detail response already contains episode summaries; avoid one request per episode when it supplies all needed fields.  Fetch episode details only for requested missing fields.  Display metadata for owned episodes; an optional Show missing episodes toggle can show unavailable rows, clearly disabled for playback.  Default off.

Verified TMDB routes (GET, base `https://api.themoviedb.org`):

| Operation | Route | Mapping requirement |
| --- | --- | --- |
| Show details | `/3/tv/{series_id}` | Show identity and season summaries |
| Season details | `/3/tv/{series_id}/season/{season_number}` | Episode records belonging to the specified season |
| Episode group list | `/3/tv/{series_id}/episode_groups` | Offer the returned group IDs for selection |
| Episode group details | `/3/tv/episode_group/{tv_episode_group_id}` | Use selected group order and episode identities, never the group ID as a season number |

References: [TV details](https://developer.themoviedb.org/reference/tv-series-details), [season details](https://developer.themoviedb.org/reference/tv-season-details), [group listing](https://developer.themoviedb.org/reference/tv-series-episode-groups), [group details](https://developer.themoviedb.org/reference/tv-episode-group-details).  Group types include Absolute (2) and DVD (3); type is a suggestion for the picker, not proof that it matches a particular file collection.  Validate response shapes against the [official OpenAPI](https://developer.themoviedb.org/openapi/tmdb-api.json) and create synthetic fixtures.  Sort by explicit group/episode order fields; retain canonical episode IDs/coordinates independently from their position in the chosen order.  Missing or repeated order values require review.

### 9.2 Fields and precedence

Show: display/original title, first-air year/date, overview, genres, rating/vote count, cast, status, season summaries, poster, backdrop and logo.  Season: number, name, overview, air date, poster and episode summaries.  Episode: number, name, overview, air date, runtime, still, rating and source metadata ID.  Movie fields retain existing behaviour.

Field priority: explicit local edit; matched metadata in selected language; original local filename/server label.  If a requested-language text is empty, use English fallback and record the field's locale/provenance.  Artwork priority follows existing requested-language, neutral, English rules.  Metadata runtime is informational; actual player duration controls resume and boundaries.  Never overwrite a manual title, number, order or match during refresh.

Changing match requires preview of affected season/episode mappings.  Preserve file progress and old match history, clear incompatible derived metadata from active display, and rebuild mappings only after confirmation.  A language change does not trigger a rematch or change local IDs.  Unmatching returns to local titles and leaves classification intact unless the user also resets it.

### 9.3 Jobs, cache and artwork

- Two metadata requests in flight maximum; one during active video playback.  Backoff on 429, obey valid `Retry-After`, otherwise exponential delay starting at 2 seconds capped at 60 seconds.  Stop automatic retries after three attempts and offer Resume/Retry.  Do not retry 401/403 indefinitely.
- Retain the current 10-second timeout and 2 MiB JSON cap.  Cache by typed entity/operation, locale and relevant image-language options.  Do not include the secret token in cache keys/logs.
- Successful metadata TTL: 7 days.  Negative match TTL: 24 hours.  Credential errors are not cached as “no match”.  Explicit Refresh bypasses stale data and negative results; offline use keeps previous good metadata visible.
- Stale-while-revalidate occurs only within the viewer's explicit lookup/auto-fetch permission.  Cancelling a job cancels pending retries and discards stale results for superseded manual matches.
- Artwork uses existing image plumbing where possible, with bounded disk LRU (initial cap 100 MiB), two fetches at once and visible-row priority.  Load thumbnails appropriate for TV cards/phone lists, not full backdrops for every row.  No artwork prefetch for the entire catalogue.
- Pause low-priority enrichment/artwork while playback buffers or the guide has a heavy retrieval job.  Keep visible cached images and manual actions responsive.  This must not pause essential source resolution, playback ranges or subtitle reads.
- Include existing TMDB attribution/branding conventions and update privacy/user documentation for any new optional background lookup behaviour.  No new calls merely because this feature ships.

## 10. TV screens and editing flows

### 10.1 Navigation

My media top-level choices: **Movies**, **TV shows**, **Needs review**, **Sources**.  Continue watching can be shared at the top with a visible Movie/Show label.  Keep existing movie favourites and sorting.  TV shows have All shows, Favourites, Recently added and source filtering.  Search covers local and matched titles; episode results identify their show/number and open that episode's detail, not an unrelated movie row.

Show detail: poster/backdrop if cached, title/year, overview, source badges, available episode count, progress, Resume/Play next, Favourite, Seasons/Episodes and Options.  Show only seasons/buckets represented by owned files unless Show missing episodes is enabled.  A date/absolute show without canonical seasons uses Year/Episodes buckets instead of inventing Season 1.

Episode row: local number/date/absolute label, title, available still, duration when known, progress/watched state, version count, unavailable status and multi-episode indicator.  Options: Play/Resume, Play from start, Choose version, Mark watched/unwatched, Correct details, Match metadata, Episode boundaries where relevant.

Display a skeleton/short loading state for uncached pages without resetting focus.  Focus identity is entity ID, not list index.  Keep a navigation stack containing view, source/show/bucket, query, focused ID and scroll anchor.  Back closes dialog, then episode list, then show, then My media in order.  A refresh that removes the focused row selects the next neighbour and announces why.

### 10.2 Continue watching and progress

One card per show: prefer its most recently actively watched unfinished episode/file; otherwise offer the next unwatched available regular episode after the latest completed one.  Do not replace a deliberately resumed old episode with the newest scan result.  A show with no playback history belongs in All shows/Recently added, not Continue watching.

Deduplicate versions and multi-episode coverage in watched counts.  Favourite is a deliberate user choice and survives merge/rescan.  Hiding a source removes its entries from shelves without erasing progress.  Recently added uses local first-discovered time; metadata refresh is not a new addition.

### 10.3 Needs review and corrections

Review reasons are actionable: missing show, missing season, conflicting season, ambiguous movie folder, uncertain date/absolute order, ambiguous show merge, incompatible old metadata, duplicate/identity collision, missing boundary mapping.  Do not force already-classified multi-episode files with unknown timestamps into a blocking error; show a boundary badge and optional review action.

Remote correction sequence:

1. Select item, open Options (hold OK also supported), choose Correct details.
2. See safe filename and ancestor labels, detected result and conflicting evidence.
3. Choose Movie, TV episode, Special, Extra/hidden, or Unclassified.
4. For TV choose/create show, then numbering mode, season/number(s), date or absolute number.  Use number controls plus existing text entry when needed.
5. Optional Apply to this folder opens a preview of affected files and unresolved conflicts.  Most-specific folder rule wins; never silently overwrite explicit file overrides.
6. Save one revisioned transaction; show Undo.  Reset correction removes the overlay and recomputes from original observations.

Show Options also include Match/change match, Order/mapping, Merge with show, Undo merge, Source preference, Mark all owned episodes watched/unwatched (preview/count), and Show missing episodes.  Missing-file options include Locate file and Remove missing entry with confirmation/undo.  Destructive library edits need normal in-product confirmation; the coding agent does not ask Moritz permission for each routine implementation step.

Web editor offers the same operations with selection, filtering, range assignment, before/after preview, and reversible batch commit.  Add a dedicated My media library section using the existing command authentication, not a new unauthenticated endpoint.  It must work on a phone browser as well as desktop.  TV remote access to individual/folder corrections remains complete.

## 11. Playback, watched state and episode progression

### 11.1 Explicit session state machine

Represent an active My media playback session with generation/session ID, show/episode/file IDs, selected order, resolver token, queue cursor, current boundary range and cancelled flag.  States: idle, resolving, playing, paused, ending, nextPrompt, resolvingNext, stopped.  Every promise/callback checks the current generation before starting or changing playback.

An explicit Play creates a new generation and cancels the old session's timers/resolution/chapter/metadata work.  Resolve each chosen WebDAV file at the time it is played.  The existing resolver decides direct authenticated playback versus signed-link mode; no show-specific authentication scheme is added.  Expired helper sessions/links are reacquired, not persisted in library records.  Player, subtitle extraction and chapter reads share the current authorised file session where compatible.

Stop, Back out of playback, source removal, opening a different item, app shutdown and phone Play of another item invalidate pending next actions.  A failed resolution stops with Retry/Choose version/Return.  Do not auto-skip a chain of failed episodes or switch to a different source without an explicit saved preference or choice.

### 11.2 Progress and watched rules

Checkpoint every 10 seconds while playing, and on pause/stop/seek/end.  Deduplicate by session ID and monotonically increasing event sequence.  Reject old sessions overwriting newer progress.  Preserve legacy movie resume semantics unless a dedicated tested migration changes them; new episode logic supports short videos.

For an episode with a known range, progress is measured within that range but stored against the physical file timeline.  Save a resume after at least 5 seconds of meaningful progress; discard a position within the first 5 seconds as “start”.  Completion requires actual forward playback since the last seek, at least `min(30 seconds, 0.1 * duration)`.  Once eligible, a natural end or logical boundary crossing marks complete; a stop near the end also counts when position reaches `duration - min(60 seconds, 0.1 * duration)`.  Examples: 30-second episode completes at 27 seconds after at least 3 seconds of continuous play; 30-minute episode completes at 29 minutes after at least 30 seconds of continuous play.  A seek alone, including one immediately followed by an ended event, never marks watched.  Track continuous playback intervals and reset completion eligibility on seeks.  Reject non-finite/negative position values and validate a plausible player duration before applying thresholds.

For unknown duration, rely on a trusted natural-ended event after at least 5 seconds of continuous playback since the last seek, or manual Mark watched.  Extremely short files whose duration is never reported may need manual completion; do not infer duration from metadata for this purpose.  A stream error, disconnect or user Stop is not a natural end.  Mark unwatched clears the selected logical episode's completion and relevant resume intent; for a shared file show a preview explaining whether file resume will also be reset.  Do not erase other episodes' explicit watch states by accident.

When selected-episode boundaries are known, Resume is offered only for a saved position inside that episode range.  A saved position in a different covered episode is labelled Resume combined file with that episode context; Play selected episode starts at its validated boundary.  Do not clamp a later file resume to an earlier episode and pretend it is that episode's progress.

For a multi-episode file without boundaries, keep one file resume; natural completion marks covered episodes watched, but seeking to the end alone does not.  Manual Mark this episode watched changes only that episode; Mark whole file watched updates all covered episodes.  With validated boundaries, update each episode when its own range is actually completed.  Resuming one version does not transplant an absolute timestamp to another version with a different edit/duration; offer Play from start on version change unless an explicit equivalent timeline mapping exists.

### 11.3 Next episode ordering

Respect `Store.settings.autoNext !== false`, as the existing provider flow does, but only following a user-started session.  Offer a cancellable five-second **Next episode** prompt at a natural end/known logical boundary; OK starts now, Back/Stop cancels and returns.  Turning auto-next off leaves a Play next action without a countdown.  Never start on scan, metadata, screen opening or progress migration.

Aired order: ascending season/episode, regular seasons only.  Date order: ascending valid date then explicit part.  Absolute/custom order: explicit mapped order key.  Do not sort lexically (`10` before `2`) or guess between incomparable orders.  Specials are separate: starting a special can continue within Specials if enabled for that playback sequence, but regular episodes never jump into Specials or vice versa automatically.

Build the next candidate from logical episodes, then select a file/version.  Skip coverage already consumed by the current multi-episode file.  Prefer a saved version choice, then the current source, then saved source rank.  If multiple equally preferred versions exist, require selection once and persist it.  Marked-watched episodes may be skipped by Play next, but a user who deliberately starts a watched episode gets sequential playback from that point; keep this queue intent explicit.

If a numbered gap is known (`E02` followed by `E04`), stop the automatic countdown and offer **Episode 3 is missing. Play episode 4?**.  If metadata reports missing intermediate episodes, apply the same rule.  Without metadata, crossing to the next available season is allowed but cannot claim all prior-season episodes exist.  An unavailable next file stops with a choice; it does not silently skip ahead.  At series end return to the originating show/episode list and restore focus.

When adjacent episode ranges share the same physical file and boundaries are validated, keep the media session and advance the logical episode context.  Pause at the boundary for the prompt if necessary; do not reload the same file or reset subtitles just to change an episode label.  If the next episode's boundary is unknown and the current file already covers it, continue the file as one playback unit and do not replay it on completion.

## 12. Multi-episode boundaries and chapters

This build includes automatic chapter inspection and manual mapping, not fabricated equal-duration splitting.

Chapter probe result: `status`, `durationSec`, `chapters[]` with start/end/name/language, selected edition, physical-timeline support flag, fingerprint and explanation.  Probe at explicit boundary editing or when a user starts a known multi-episode file; do not download all files during a scan.  Cache by file identity plus size/modification/ETag fingerprint.  A changed file invalidates derived boundaries and asks for review of saved user timestamps.

MKV: parse EBML header/segment and SeekHead to locate Chapters, with a bounded initial header search if no seek entry exists.  Support simple chapters in the default edition, nested labels, language labels and physical timestamps.  ChapterTimeStart/End are nanoseconds, independent of TimestampScale.  Do not silently apply ordered/linked-edition virtual times to the player's physical timeline.  For those editions, expose safe physical markers only if proven, otherwise provide manual physical-time editing and full-file playback.  See [Matroska chapters](https://www.matroska.org/technical/chapters.html).

MP4/M4V: support Nero-style `chpl` atoms and QuickTime chapter text tracks referenced via `tref/chap`, using sample timing/table data to obtain labels and physical presentation times.  Handle normal/extended atom sizes and `moov` before or after `mdat`.  Interpret edit-list timing only for cases supported by fixtures; otherwise return unsupported timing and offer manual mapping.  Do not assume all MP4 chapter systems share the same layout.  Apple documents chapter lists as a referenced text track whose sample display times mark chapter starts: [QuickTime chapter lists](https://developer.apple.com/documentation/quicktime-file-format/chapter_lists).  For the separate Nero form, the [mp4v2 chpl implementation](https://github.com/TechSmith/mp4v2/blob/master/src/atom_chpl.cpp) is a primary implementation reference; its format comments include uncertainty, so do not treat one writer's layout as a universal standard.  Confirm supported variants with synthetic byte fixtures and reject unrecognised variants safely.  Implement the parser independently; do not copy licensed implementation code without checking repository compatibility.

Probe resource budget: at most 8 MiB total fetched, 1 MiB per range, 32 range requests, 10 seconds active network time, 2,000 chapter entries, and nesting depth 16.  Validate 206 Content-Range and exact body bounds.  Abort servers returning the full media body or malformed lengths; playback still works.  No full-file download and no reliance on ffmpeg being installed on the TV.  Share range validation concepts with `mkvsubs.js`, but do not couple subtitle extraction to completion of chapter probing.

Auto-map boundaries only when chapter labels uniquely identify every covered episode in increasing physical time, or a user-selected explicit chapter mapping does so.  Generic “Chapter 1”, intro/credits markers, or simply having N chapters for N episodes is insufficient evidence.  The final episode may end at actual media duration; an earlier one ends at the next selected start.  Boundaries must be nonnegative, ascending, nonoverlapping and within known duration; incomplete or ambiguous mappings stay editable.

Manual boundary UI: select an episode, choose a chapter or type hours/minutes/seconds using remote controls; **Use current playback position** supplies a convenient timestamp.  Show all ranges with labels, validation and Preview segment.  Preview is an explicit playback action and participates in session cancellation.  The editor provides the same table with easier text input.  Reset automatic/manual boundaries is reversible.

Selecting episode 2 in an unsplit file without boundaries offers **Play combined file** and **Set episode start**, with a clear explanation.  It must not falsely promise to start at episode 2.  This fallback is a correct working feature for media that has no chapter evidence.

## 13. Android and phone protocol

Preserve existing requests with `kind: "media"` as movie-only responses.  Add capability `vod2.mediaLibraryVersion: 2` and new request types to the authenticated ask dispatcher:

| Request | Arguments / response |
| --- | --- |
| `medialibrary` | View movies/shows/continue/review, query/source/cursor/limit; paginated typed cards |
| `mediashow` | Show handle; details, season/order-bucket summaries, actions, current progress |
| `mediaepisodes` | Show handle + bucket + cursor/limit; paginated episode rows |
| `mediaepisode` | Episode handle; details, progress, available version summaries, boundary capability |
| `mediaplay` | Entity handle, optional version handle, fromStart; starts on TV through the same explicit session path |
| `mediaedit` | Limited favourite/watched operations with revision; bulk/complex correction opens editor or uses TV flow |

Reuse helper projections and opaque handles.  Never serialize locators, helper URLs or tokens.  Artwork is an approved image URL/cache endpoint using existing phone image conventions; it must not reveal source-file locations.  Phone lists are capped at 100 rows per request and all-season payloads are forbidden.

New Android + old TV: omit new screens/actions and retain movie browsing when capability absent.  Old Android + new TV: existing movie endpoints and `vod2.media` boolean behave as before.  New Android + new TV: My media has Movies/TV shows, show detail, buckets, episode details, version choice, resume/start and Play on TV.  Date/absolute labels are explicit strings/typed fields, not forced into the existing integer episode field.

Add dedicated `MediaShow`, `MediaEpisode`, `MediaVersion`, `MediaPage` models where existing provider `VodInfo` would require incompatible changes.  Update `Ask.kt`, `Protocol.kt`, request/repository plumbing, `VodTab.kt` or a dedicated My media screen, and `AppModel.kt` as required by actual ownership.  Preserve provider browsing.  Update `tests/android/fake-tv.js`, JVM JSON parsing tests and Android UI/device CI coverage.  Android is built in CI according to the repo guide; do not claim local APK validation without running a supported pipeline.

Phone Play while the TV is playing another item is a deliberate replacement: cancel old auto-next and start the selected item.  Disconnecting the phone does not stop an already-started TV session.  Stale entity handles return a useful refresh-needed result; never fall back to a different item by list position.

## 14. Performance and concurrent work

Acceptance corpus: at least 50,000 episodes plus 5,000 movies across multiple sources, including one large show and one large DLNA folder.  These are test targets, not measured current capacity.  Record baseline and changed memory, first-page latency and scan throughput.

Initial budgets: app retains at most 180 rows per list and at most 1,000 loaded episode/card records total; helper page cache 8 MiB; no catalogue-sized JSON response; first cached local page under 1 second on the C9; navigation feedback under 100 ms; helper incremental working memory target below 64 MiB for catalogue operations excluding existing unrelated guide buffers.  If hardware misses a budget, profile and fix or report measured blockers before declaring the build done.

Scheduling priority: playback/source resolution and subtitle ranges; explicit navigation/commands; active-source scan batches; requested metadata; background metadata/artwork.  One scan per source, at most two sources actively fetching, reduced to one during playback.  Avoid synchronous full-index rebuilds on the request/event loop.  Yield between bounded batches and preserve progress under guide download load.

Use thumbnail placeholders and cancel out-of-view image requests.  Retain the existing subtitle fixes: single selected overlay, reset on seek, no bilingual stale cues, shared authorised file URL.  Include a guide-download + seek + subtitles + scan smoke test on the TV.  A browser mock cannot establish hardware decoding quality.

## 15. Implementation sequence: one complete build

Each milestone ends in a working commit with its targeted tests.  All milestones are required before this feature is presented as complete.

1. **Integration baseline.** Read repo rules, check branches, create an isolated feature worktree, establish baseline tests, inventory subtitle/WebDAV/guide commits and avoid duplicate cherry-picks.  Preserve unrelated work.
2. **Contracts and fixture corpus.** Define serializers, observations, source modes, identity rules, error codes, capabilities and synthetic layout/metadata/container fixtures.  Create failing behavioural tests for the risky invariants.
3. **Storage/migration/query.** Implement durable paginated generations, indexes, v1 migration/recovery, revisioned overlays/progress, query facade and legacy movie adapters.  Fault-injection tests pass before switching default readers.
4. **Traversal and classifier.** Add ancestry, resumable cursors, scope accounting, safe dedup, root/mixed layouts, every numbering scheme, movie/extras fixes and source controls.  Feed v2 storage incrementally.
5. **Grouping/corrections.** Add durable shows/episodes, versions, folder rules, merge/unmerge, relink, mapping/order and review projections.  Test idempotent rescans and conflicting edits.
6. **Metadata and chapter services.** Implement all typed TMDB operations, match UI data, localisation/artwork/jobs, MKV/MP4 probes and boundary validation/manual mapping backend.  Test failure and cancellation paths.
7. **TV screens and full remote workflows.** Implement lists/details/review/source controls, correction dialogs, favourites/history, metadata and boundaries.  Test focus, back stack and virtualisation.
8. **Playback progression.** Integrate session cancellation, exact progress/watched semantics, version selection, date/absolute/custom order, multi-episode boundaries, next prompt and missing-episode behaviour.  Preserve subtitle lifecycle.
9. **Web editor and Android.** Implement batch editor flows, capability negotiation, phone paginated browsing/play, compatibility tests and Android CI verification.
10. **Combined verification and handoff.** Run complete gates in the test document, update user guide/changelog/privacy/protocol docs, build one integrated IPK, and verify on the C9 when deployment is authorised for this implementation.  Record any unavailable hardware/CI gate accurately rather than declaring it passed.

The current task produces the specification only.  No feature code, tests, APK/IPK or TV deployment is implied by this document.  At implementation time, use the user's active instructions for deployment/PR scope; the plan itself is not permission to publish or contact maintainers.

## 16. Additional implementation contracts and examples

### 16.1 Enums, defaults and validation

Use these canonical values in v2 records and DTOs; legacy adapters translate to existing movie fields:

```text
kind: movie | episode | unclassified | extra
contentMode: automatic | movies | shows
order: aired | date | absolute | group | custom
availability: available | missing | offline | excluded
watchState: unwatched | inProgress | watched
scanState: queued | running | pausedBudget | pausedUser | blockedAuth |
           blockedScope | completed | failed | cancelled
matchOrigin: user | exactAuto | legacyUnknown
boundaryOrigin: chapters | user
```

`offline` means the source/file could not be reached now, not that an authoritative scan found it absent.  `excluded` is a user/rule presentation state and cannot count as evidence of deletion.  A cancelled job is invalidated; a user pause saves a resumable job.  In the route table, `/scan/cancel` defaults to pause for a resumable user stop; accept explicit `discard: true` to invalidate it.  Name the UI action Pause scan when preserving a resumable job.

Source defaults: new `contentMode: automatic`, existing migrated `contentMode: movies`; `discoveryEnabled` reflects whether show discovery has been enabled and is not a second contradictory switch.  Use it only as migration/onboarding history; effective behaviour comes from contentMode.  `defaultOrder: aired` is a UI preference for unresolved corrections, never evidence that missing seasons equal 1.  Show defaults: `order: aired` for season-numbered files, date/absolute when that identity is established; `showMissingEpisodes: false`; favourite false.  App metadata preference `autoFetchNew: false`; playback auto-next reuses the existing setting.  Specials continuation is off unless explicitly enabled for the current special playback sequence.

All season numbers are nonnegative integers; numbered episodes and absolute numbers are positive integers.  Unnumbered specials use null plus an explicit label.  Absolute decimal specials use a structured base/part order key, not floating-point arithmetic on an episode number.  Air dates must round-trip as an actual `YYYY-MM-DD` calendar date.  Null means unknown; do not use 0 for unknown season, since 0 means Specials.  All IDs are strings.  External metadata identifiers are validated by provider/type, and group IDs remain opaque strings.

At ingest, cap display titles at 512 characters, descriptions at 16,384, ancestry depth at the configured maximum, and one classification's episode coverage at 50 unless a user supplies a validated larger custom mapping through paginated editing.  Reject oversized commands with a useful message; do not silently truncate identity fields into collisions.  Protected locator length/encoding validation belongs to the source adapter, separate from display-title limits.  Public editor/phone bodies have an explicit bounded size, initially 1 MiB; large bulk changes use a server-side selection/preview token rather than thousands of client-supplied full records.

### 16.2 Paginated episode request and response

These examples describe new DTOs; existing phone movie DTOs remain unchanged.  `handle` is opaque and resolves to internal IDs, never a URL/path.  An episode card is deliberately smaller than detail/membership records.

```json
{
  "kind": "episode",
  "show": "h_show_demo",
  "bucket": "season:1",
  "limit": 60,
  "cursor": null
}
```

```json
{
  "schema": 2,
  "revision": 18,
  "items": [
    {
      "handle": "h_episode_demo",
      "kind": "episode",
      "show": "h_show_demo",
      "label": "S01E02",
      "title": "The return",
      "season": 1,
      "number": 2,
      "airDate": null,
      "absoluteNumber": null,
      "watchState": "inProgress",
      "progressPercent": 30,
      "available": true,
      "versionCount": 2,
      "combinedFile": false,
      "image": null
    }
  ],
  "nextCursor": null,
  "total": 1
}
```

Show/bucket detail contains available/owned counts separately from metadata total counts.  `progressPercent` is bounded 0–100 and null when unknown; it is a display value, never the source of watched state.  An unknown image is null, not a request to load a broken URL.  Handle resolution enforces source existence and current aliases; a phone cannot supply an arbitrary file path to Play.

### 16.3 Edit preview and commit

For a folder correction, the initial preview request identifies the folder by an opaque scope handle, the proposed fields and expected revision.  The helper applies existing file-level precedence to a bounded/indexed selection and returns counts, example changes, conflicts and a preview token.  It does not update the library yet.

```json
{
  "operation": "setFolderRule",
  "preview": true,
  "target": "h_folder_demo",
  "expectedRevision": 18,
  "fields": {
    "kind": "episode",
    "show": "h_show_demo",
    "order": "aired",
    "season": 1
  }
}
```

```json
{
  "operation": "commitPreview",
  "previewToken": "preview_demo",
  "expectedRevision": 18,
  "idempotencyKey": "edit_demo_001"
}
```

Add `commitPreview` and `undoEdit` to the edit dispatcher alongside the operations in section 6.3.  Preview tokens bind operation, selection, revision and authenticated session; expire after 15 minutes or a conflicting mutation.  Return the committed revision and undo handle.  Undo is itself a revisioned transaction: restore affected fields/memberships only, preserving unrelated newer progress or edits.  If the same fields changed again, return a conflict preview instead of erasing that work.  Keep the latest 50 user edit transactions or 30 days, whichever prunes first, while retaining migration recovery separately.  Show undo expiry in developer documentation, not as a misleading promise of permanent history.

### 16.4 Completion and cancellation pseudocode

App pseudocode below expresses ordering requirements, not ready-to-paste implementation:

```text
onExplicitPlay(entity, intent):
    cancelActiveSessionAndInvalidateGeneration()
    session = newSession(entity, intent)
    chooseFileOrAskUser(session)
    resolveChosenFile(session, callback):
        if session is no longer current: release result, return
        if error: show retry/version/return, remain stopped, return
        startCommonPlayerWithSharedAuthorisedFileSession()

onNaturalEndOrKnownBoundary(event):
    if event belongs to an old session or was already handled: return
    applyEligibleProgressAndWatchedEvent()
    decision = Queue.next(currentLogicalItem, session.intent, ownedOrderedItems)
    if stopped/cancelled or generation changed: return
    if decision requires a gap/version choice: show explicit action, return
    if autoNext disabled: show Play next without timer, return
    show cancellable next prompt; on expiry resolve next under same generation

onBackOrStopOrReplacement():
    invalidate generation before cancelling network/timers
    save final progress for the departing session once
    cancel prompt, queued resolution and outstanding preview work
    stop common player and restore originating focus
```

A physically continuous multi-episode file uses the same session/authorised URL when advancing logical context.  Flush the outgoing episode's progress before changing its identity.  At a boundary, pausing for a prompt must not clear chosen subtitle language; cancelling/returning still performs the normal stop/reset lifecycle.  An old completion event cannot run again because a state transition replaced the episode context.

### 16.5 Source-of-truth precedence

When two observations disagree, decide by field ownership, not request completion time:

| Field group | Owner |
| --- | --- |
| Locator, file size, modification marker, observed ancestry | Current accepted source observation |
| Classification/title/order corrections | Most-specific saved user override, then classifier evidence |
| Metadata match | Latest explicit user match revision; exact auto-match only if still unmatched and permitted |
| Metadata text/art | Current match + requested locale, subject to user field overrides |
| Resume | Latest accepted playback session/event sequence for that file |
| Manual watched reset | Explicit watch revision; older playback events cannot override |
| Show/episode identity and aliases | Library transaction layer, never a metadata response |
| Source active/removed state | Current source configuration revision, never scan response |

After a manual Mark unwatched during active playback, increment the watch revision and reset the current session's completion eligibility.  New forward playback can subsequently mark it watched again only after satisfying the normal completion rule; callbacks generated before the reset cannot.  This avoids both an immediate stale re-mark and a permanent inability to finish the episode.
