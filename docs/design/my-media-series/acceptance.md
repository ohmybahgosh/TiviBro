# My media complete build: acceptance and implementation test specification

Companion to [the main specification](specification.md).  These are required behaviours to implement and verify, not claims that new tests already exist or have passed.  Use synthetic names, local mock servers and generated container bytes.  No real library paths, credentials or signed media URLs belong in committed fixtures.

## 1. Test organisation

Keep useful existing tests.  Add the new files below or split an existing suite when it improves isolation; register new unit suites in `package.json`.  Test observable behaviour, durable state and cancellation, not implementation function names or mirrored regex expressions.

| Proposed suite | Coverage |
| --- | --- |
| `tests/unit/media-classify.test.js` | Filename/ancestor/server evidence; all naming forms; conflicts, movie folders and extras |
| `tests/unit/media-library.test.js` | Identity, grouping, overrides, versions, paging, merge/unmerge and relink |
| `tests/unit/media-migrate.test.js` | Legacy snapshots, type-aware metadata, interrupted migration and transactional recovery |
| Extend `tests/unit/media-service.test.js` | WebDAV/DLNA discovery, pagination, durable jobs, cancellation and scope errors |
| Extend `tests/unit/media-store.test.js` | App facade, small state, query cache and stale responses |
| Extend `tests/unit/media-metadata.test.js` | Typed TMDB operations, locale/provenance, matching/cache/jobs |
| Extend `tests/unit/media-metadata-ui.test.js` | Match correction, incomplete enrichment, loading/error states |
| `tests/unit/media-chapters.test.js` | Generated MKV/MP4 chapter parsing, limits, mapping and timestamps |
| `tests/unit/media-queue.test.js` | All ordering schemes, versions, gaps, specials and multi-episode coverage |
| Extend `tests/unit/media-races.test.js` | Stop/Back/source removal/phone Play racing with resolve/next/progress |
| Extend `tests/unit/media-editor.test.js` | Bulk preview/commit/revision/undo and sanitised payloads |
| Extend companion/phone suites | Old/new capability matrix, pagination, opaque handles and explicit Play |
| `tests/soak/media-series.js` | Remote navigation, all TV screens, resume/watch state, correction and metadata |
| Extend `tests/soak/media-editor.js` | Mobile/desktop bulk workflows and boundary editing |
| Extend `tests/soak/phone-asks.js` | New phone contract, old requests retained |
| Android JVM + UI suites | JSON models, capability fallback, show/bucket/episode/version screens and Play on TV |
| `tests/soak/media-large.js` | Generated large library, pagination, memory counters and concurrent activity |

Use existing unit assertion conventions.  Fake the clock and resolver where deterministic ordering matters.  Every deferred callback test must assert no unexpected player start after cancellation, not merely that a token variable changed.  Container probes use byte-level fixtures, not only mocked parser outputs.

## 2. Common fixture library

Create a reusable source tree builder with the same logical layout served over both mock WebDAV and mock DLNA.  Each file has a deterministic source ID, size, content marker and optional structured metadata.  It can expose the same resource in several DLNA views or distinct resources with equal names/sizes.  Network delay/failure/Range behaviour are configurable per request.

```text
Library/
  Amber.Road.2021.mkv
  Harbour.S01E01.mkv
  Harbour.S01E02.mkv
  Episode.02.mkv
  Film.57.mkv
  Star.Wars.Episode.IV.1977.mkv
  Collection (2020)/
    Glass.River.2018.mkv
    Bright.Field.2022.mkv
  Orchard (2023)/
    video.mkv
    Extras/trailer.mp4
  Harbour/
    Season 1/
      Episode 03.mkv
      Harbour.S01E04E05.mkv
      Harbour.S01E06.1080p.mkv
      Harbour.S01E06.2160p.mkv
    Season 2/
      01 - Return.mkv
      Harbour.S03E02.mkv
    Specials/
      S00E01.mkv
      Behind the scenes.mkv
  Daily Window/
    Daily.Window.2026-10-30.mkv
    Daily.Window.2026-10-31.mkv
    Daily.Window.2026-02-30.mkv
  Moon Courier/
    [DemoGroup] Moon Courier - 057 [1080p].mkv
    [DemoGroup] Moon Courier - 058 [1080p].mkv
  Footage/
    2026-10-31.mp4
```

Define metadata fixtures using invented IDs and titles, never a live API requirement.  Include two same-title shows with different years, movie/TV entities with the same numeric TMDB ID, two episodes on one air date, a selected episode group, missing translations/images, and one intentionally inconsistent group response.

For snapshot migration fixtures include: one movie favourite, one valid resume, one old movie metadata match, one source with zero saved files, one source with partial history, and duplicate DLNA path-only IDs requiring collision handling.  Mark all times/fingerprints deterministic.

## 3. Classification acceptance matrix

Run each relevant case through both pure classifier and source-to-library integration.  Check kind, grouping evidence, review reason and physical file count.

| ID | Input/action | Required result |
| --- | --- | --- |
| C01 | Root movie plus nested movie folders | Both reachable as movies; recursion not an opt-in requirement |
| C02 | Several unrelated videos in `Collection (2020)` | Separate titles; no collection-name overwrite; none discarded by relative size |
| C03 | `Orchard (2023)/video.mkv` with identifiable extras | Movie inherits title/year; extras remain recoverable |
| C04 | `Harbour.S01E02.mkv` | Show Harbour, season 1, episode 2 |
| C05 | `Harbour 1x02` and `Harbour S1 E2` | Same logical episode, distinct files if different resources |
| C06 | `Harbour/Season 1/Episode 02.mkv` | All identity fields derived from combined ancestry and filename |
| C07 | Bare root `Episode 02.mkv` | Needs review, missing show/season; no invented season 1 |
| C08 | `Harbour/Season 1/02 - Return.mkv` | Episode 2 with established context |
| C09 | Filename S03 versus folder Season 2 | Conflict in review, both observations retained |
| C10 | `S00E01` / numbered Specials | Season 0, kept out of regular auto-next order |
| C11 | Unnumbered special | Reachable; no fabricated numeric episode |
| C12 | `S01E01E02`, `S01E01-E03`, `1x01-03` | Correct coverage, one physical file per input |
| C13 | Descending range or >50 expanded numbers | Invalid mapping/review, bounded parser work |
| C14 | `Star Wars Episode IV` | Movie; Roman numeral title is not an episode token |
| C15 | `Film.57`, `2160p`, `x265`, `5.1`, release checksum | No accidental episode number extraction |
| C16 | Confirmed 45 MB episode beside 3 GB movie | Episode retained, not treated as extra |
| C17 | Explicit sample file with manual Include override | Included; rescan preserves override |
| C18 | Release-group anime 057 / 058 | Absolute identity; no fabricated season; numeric order |
| C19 | Generic `Show - 057` without order/context | Review suggestion; applying Absolute folder rule resolves it |
| C20 | Absolute special 12.5 | Preserved structured special label; not rounded |
| C21 | Valid title + date | Date identity/year bucket; calendar date unchanged by timezone |
| C22 | Invalid date 2026-02-30 | Review; no normalised March date |
| C23 | Leap date 2024-02-29 vs 2025-02-29 | Valid vs invalid respectively |
| C24 | Date-only camera filename | Uncertain movie/footage, not assumed daily show |
| C25 | Movie named with a full date | Ambiguity preserved; user can explicitly classify movie |
| C26 | Structured DLNA show/episode without season | Retain server fields; missing season stays unresolved unless another supported order supplies identity |
| C27 | Malformed/vendor metadata | Ignored as unsupported evidence; no crash/false certainty |
| C28 | Accents/non-Latin show titles | Names preserved; comparison stable without modern regex features |
| C29 | File override versus folder override | File wins; resetting file override reveals folder result |
| C30 | Two nested folder rules | Most-specific wins; preview reports excluded explicit file overrides |

## 4. Traversal, merge and identity

| ID | Fault/setup | Required result |
| --- | --- | --- |
| S01 | 450-item DLNA folder | All three pages processed; no duplicates |
| S02 | Pause after page 2, restart helper | Resume saved cursor; all items eventually found |
| S03 | Repeated first page / cyclic container | Detect no progress; stop scope, never infinite loop |
| S04 | Same file in root/genre/folder DLNA views | One file, retained useful ancestry |
| S05 | Two different resource query variants | Do not merge unless adapter evidence proves same resource |
| S06 | Paths with spaces, percent escapes, mixed case | Canonical identity stable; no double decode or case collapse |
| S07 | WebDAV href outside source root | Reject, sanitised diagnostic |
| S08 | Scan hits depth/folder/time budget | Paused/incomplete with resumable frontier, no deletion |
| S09 | WebDAV directory body exceeds cap | Visible incomplete scope, old entries retained, no endless retry |
| S10 | Auth fails after some pages | Pause source, preserve committed discoveries/history, actionable auth error |
| S11 | One nested folder returns 404 | Scope incomplete, previously saved descendants retained |
| S12 | Empty successful source result | Protect old library; Review source action |
| S13 | Complete nonempty scan omits old file | Mark missing, retain progress/corrections; Restore when rediscovered |
| S14 | Mode/exclusion changes during scan | Reject stale generation; filtered items not considered deleted |
| S15 | Remove source while response pending | No source resurrection or late playback |
| S16 | 500-entry in-memory frontier exceeded | Spill to disk; resume works without dropping queue entries |
| S17 | Two equal names/sizes, different files | Separate physical records, possibly episode versions |
| S18 | Same-title remakes / two possible show folders | No title-only merge; review candidates |
| S19 | Flat + folder files with one compatible show | Join once, maintain identities across rescan |
| S20 | Cross-source same confirmed TV ID/order | One show, source-specific versions/progress retained |
| S21 | Cross-source same title only | Separate shows until user merge or confirmed match |
| S22 | Conflicting episode orders on merge | Preview mapping conflict; no guessed merge |
| S23 | Merge then unmerge after metadata refresh | Recover membership/aliases and per-file history |
| S24 | Merge then manual watch edit then split | Apply specified watch-state provenance rules consistently |
| S25 | Rename with tested stable server file ID | Automatic relink preserves physical history |
| S26 | Same size/ETag-ish evidence without stable ID | Suggest relink; no automatic history reassignment |
| S27 | Manual relink conflicts with target history | Preview/choice, transaction, undo restores both |
| S28 | Old DLNA path ID collision | Preserve established identity; new collision-safe ID, ambiguity review |
| S29 | Repeated unchanged scan | No new show IDs, duplicate memberships, changed added dates or unnecessary match jobs |
| S30 | New files added during long server scan | No crash; eventual rescan discovers them; no claim of server snapshot consistency |

## 5. Persistence and migration fault injection

Every D-series test checks both returned status and reopening the persisted library in a new process.

| ID | Injection | Required result |
| --- | --- | --- |
| D01 | Ordinary v1 migration | IDs/favourites/resume/added dates preserved; entries default to movies |
| D02 | No legacy resume | Unwatched/unknown, never assumed watched |
| D03 | Legacy movie metadata later reclassified to TV | Old match recoverable but not displayed as TV metadata |
| D04 | Crash writing staging page | Old manifest remains authoritative; recover/retry migration |
| D05 | Crash after pages renamed, before manifest | No half-visible generation; orphan cleanup safe |
| D06 | Crash after manifest commit, before app acknowledgement | Restart finds committed generation; migration not duplicated |
| D07 | Truncated/corrupt newest manifest/page | Recover prior fully valid generation; visible recovery status |
| D08 | ENOSPC at page/index/manifest write | Error acknowledged; prior committed data readable |
| D09 | Override saved while scan applying | Latest explicit edit survives scan commit |
| D10 | Old metadata response after new match | Old response ignored for active fields |
| D11 | Progress callback from old play session | Cannot overwrite new-session progress |
| D12 | Stale batch preview revision | Conflict result, no partial application |
| D13 | Retry same edit idempotency key | Exactly one transaction/effect/undo record |
| D14 | Change show title/language/order | Physical IDs and watched state unchanged |
| D15 | Stale query cursor after library edit | STALE_CURSOR; UI reloads around anchor without duplicate rows |
| D16 | Missing storage before migration | V1 preserved; feature setup error, no false success |
| D17 | Helper outage after v2 migration | Cached projection read-only; no divergent v1 writes |
| D18 | Large legacy migration | Bounded parser memory; no whole-array app transfer |
| D19 | Cleanup prior generation | Only unreferenced pages removed; current/previous valid manifests remain usable |
| D20 | Restore pre-migration snapshot | Original v1 state recovers; v2 retained separately, no claimed backport of v2 edits |

## 6. Metadata and artwork

| ID | Setup | Required result |
| --- | --- | --- |
| M01 | No token; mixed source scan | Fully usable local classification/browsing/play; zero TMDB requests |
| M02 | Token present, no auto-fetch consent | Scan still makes zero TMDB requests |
| M03 | Explicit Fetch details for show | TV search/detail then owned season summaries, not movie endpoints |
| M04 | Movie ID 42 and TV ID 42 | Separate typed cache entries |
| M05 | Exact unique title + compatible known year | Permitted automatic match within requested job |
| M06 | Two title matches / wrong year | Candidate UI; popularity not identity |
| M07 | Selected locale text absent | English/local fallback with field provenance |
| M08 | User title/number edited then metadata refresh | User fields unchanged |
| M09 | Date maps uniquely to fetched episode | Add canonical coordinates without changing episode ID |
| M10 | Two episodes air same date | Review mapping, never first-result selection |
| M11 | Absolute number with no verified group | Remains Absolute; no concatenated-season mapping |
| M12 | Selected episode group gives valid mapping | Explicit order retained; different group switch previews changes |
| M13 | Group contains duplicate/missing/contradictory entries | Mapping validation and review |
| M14 | Token 401/403 | Credential message; no repeated retries/no negative “not found” cache |
| M15 | 429 with Retry-After | Delay honoured; cancellation interrupts wait; bounded retries |
| M16 | Timeout / offline / 5xx | Old good metadata visible; retry action; no identity loss |
| M17 | Request cancelled then match changed | Old response cannot overwrite new match |
| M18 | Large show | Owned season requests only; no per-episode fan-out when summaries suffice |
| M19 | Missing-episode toggle | Metadata rows disabled for Play; counts distinguish owned/missing |
| M20 | Language change | Reuse same match/IDs, fetch permitted locale cache as needed |
| M21 | Cache TTL and negative-cache refresh | Deterministic fake-clock tests; explicit Refresh bypasses |
| M22 | Artwork failure / LRU eviction | Placeholder, no broken focus/layout; refetch only when needed/permitted |
| M23 | Guide busy / player buffering | Background requests yield; subtitles/resolve remain prioritised |
| M24 | Phone/editor/log snapshots | No token, credential-bearing URL, raw locator or helper session secret |

## 7. Chapters and multi-episode files

Generate minimal binary fixtures with independently calculated expected timestamps.  Include malicious lengths/offsets, not just valid files.  Validate total fetched bytes/request count with the mock server.

| ID | Container/action | Required result |
| --- | --- | --- |
| B01 | MKV default simple edition, SeekHead -> Chapters | Correct physical seconds and labels |
| B02 | MKV different TimestampScale | Chapter nanoseconds not mistakenly scaled like cluster timestamps |
| B03 | Nested/multilingual chapters | Bounded traversal, useful label chosen, parent/child ambiguity retained |
| B04 | Ordered/linked edition | No false physical boundary mapping; explanation/manual fallback |
| B05 | Missing SeekHead, bounded header discovery | Find reachable chapters or cleanly report unavailable |
| B06 | MP4 `chpl` | Expected chapter labels/times; validate version/layout |
| B07 | MP4 chapter text track and sample timing | Correct physical presentation times from fixture |
| B08 | `moov` after large `mdat`, extended atom sizes | Seek by validated offsets without downloading media body |
| B09 | Unsupported edit-list timing | Safe unsupported result, full-file/manual playback available |
| B10 | Huge element length, bad nesting, integer overflow | Reject within budgets; no allocation explosion |
| B11 | Server ignores Range / invalid Content-Range | Abort probe early; normal playback not blocked |
| B12 | 8 MiB/32-request/time limit reached | Cancelled/limited result; no covert continued download |
| B13 | Exact S01E01/S01E02 chapter labels | Unique ascending match produces valid boundaries |
| B14 | Generic Chapter 1/2, intro/credits | Never automatic episode split merely from chapter count |
| B15 | Manual overlapping/negative/out-of-duration range | Validation error; previous mapping preserved |
| B16 | File fingerprint changes | Invalidate derived boundaries, review manual timestamps |
| B17 | Episode 2 selected without boundary | Explain combined file, offer Set start; no false episode-start seek |
| B18 | Manual Use current position + preview | Correct timeline, explicit playback, cancellable preview |
| B19 | Same file consecutive segments | No duplicate load or stale subtitle overlay at transition |
| B20 | Multi-episode file no chapter evidence | One resume; full completion marks coverage; next skips repeated coverage |

## 8. Playback and races

Capture actual calls to player start/stop/seek and resolver.  Assert call count, entity identity and ordering.  Use both immediate and deferred resolution.

| ID | Scenario | Required result |
| --- | --- | --- |
| P01 | Start episode, Stop before resolve | Zero late player starts |
| P02 | Next countdown, Back | Timer cancelled; origin focus restored |
| P03 | Next resolving, phone plays different movie | Only phone-selected item starts; old result ignored |
| P04 | Next resolving, source removed | No playback from removed source |
| P05 | Auto-next off | Explicit Play next available, no countdown/start |
| P06 | E2/E10 filenames | Numeric order, never lexical |
| P07 | Last regular episode in season, next available season | Correct next regular season; no Specials insertion |
| P08 | Explicit special playback | Follows specified special sequence policy only |
| P09 | E02 then E04 | Gap prompt; no silent automatic jump |
| P10 | Next file offline/resolve fails | Stop with Retry/version/return; no skip loop |
| P11 | Expired signed URL/helper session | Resolve fresh for chosen file; stale session not stored as locator |
| P12 | Direct authenticated source | Same playback/subtitle/chapter authorisation context, no credentials in app-facing logs |
| P13 | Several versions | Explicit/saved preference applied; equal candidates require choice |
| P14 | Change version with different duration | No blind timestamp transfer; clear start/resume choice |
| P15 | 30-second episode natural playthrough | Meaningful resume and watched state; no 60-second-only assumption |
| P16 | Seek to last second then Stop/end | No watched mark merely from seek; eligibility rule enforced |
| P17 | Near-end stop after required continuous play | Correct threshold completion and resume clearing |
| P18 | Unknown duration + trusted natural end | Completion only with meaningful playback and trusted end |
| P19 | Playback error/disconnect | Not equivalent to natural end |
| P20 | Manual Mark unwatched then stale progress event | Manual reset wins; no immediate re-mark by old session |
| P21 | Resume multi-episode file midway through episode 2 | Correct logical context and physical timestamp |
| P22 | Select episode 1 while saved position lies in episode 2 | Offer file resume vs selected episode start clearly; no misleading episode-1 resume |
| P23 | Multi-episode E1–E2 file then separate E2/E3 | E2 not played twice after combined file completed |
| P24 | Watched old episode deliberately replayed | Sequential intent preserved; not jumped to newest unwatched item |
| P25 | Date/absolute/custom order queue | Follows chosen keys and mapping, no fake seasons |
| P26 | Scan or metadata finishes on open show screen | No playback starts |
| P27 | Repeated ended callbacks | Exactly one completion event/countdown/next start |
| P28 | Guide downloading plus backwards/forwards seek | Only selected subtitle language; no stale bilingual cues, responsive navigation |

## 9. Interface, compatibility and scale

U01–U10 are remote-only scenarios: Movies/Shows navigation; season/episode selection; resume/start; version selection; favourite; watched/unwatched; classify one file; apply/reset folder rule; match/unmatch; merge/unmerge/relink.  Every dialog must close one level with Back and preserve focus/scroll.  Keyboard/mouse shortcuts cannot be the only way to complete a task.

U11: Date/Absolute/Episode-group order switching and manual mapping work on TV.  U12: Boundary entry supports number controls and current-position capture.  U13: Needs review is reachable with no playable metadata.  U14: offline/artwork/missing-item states do not leave focus on a removed button.  U15: source mode changes report true counts and do not lose history.  U16: web editor mobile viewport can preview, apply and undo multi-selection edits.  U17: a stale editor batch receives a useful conflict and reloads its preview.

N01: Old phone + new TV retains movie-only media requests.  N02: new phone + old TV detects absent capability and falls back.  N03: new phone + new TV browses paginated shows/buckets/episodes/versions.  N04: opaque handles map correctly after merge; deleted/stale handles ask to refresh.  N05: phone Play routes through the same TV session cancellation path.  N06: provider movie/series phone screens remain unchanged.  N07: all new optional JSON fields safely parse when absent/null; required malformed identities fail cleanly.

L01: Generate 50,000 episodes + 5,000 movies; confirm bounded app cache and helper page cache.  L02: one show with thousands of episodes never returns all episodes in `detail`.  L03: full source scan progresses across budget checkpoints and helper restarts.  L04: run query/navigation during scan/index updates and record event-loop responsiveness.  L05: repeat with guide retrieval and active playback, measuring baseline and changed memory.  L06: search fast typing cancels stale results.  L07: artwork cache obeys disk/parallel limits.  L08: real C9 cached first page target <1 second and input feedback <100 ms; document actual measurements and investigate misses.

Security checks are concrete regressions: existing helper secret protects every new route; editor/phone authentication is required; path traversal outside source root rejected; locator/token fields excluded by projection; metadata cannot inject HTML; batch body/field lengths bounded; malformed container offsets cannot trigger arbitrary remote fetches.  Do not create unrelated security infrastructure.

## 10. Commands and release gates

Read scripts and current `package.json` before running, because branch integration can change the commands.  These commands exist in the reviewed checkout:

```sh
npm run lint
npm test
npm run build
bash tests/engines/run.sh
```

New targeted unit commands follow `node tests/unit/<suite>.test.js`.  Browser suites require the existing mock provider and app/relay serving setup described in the repo guide; inspect each suite's header.  Do not invent a new `npm run test:series` command unless it was actually added.

Build caveat from this workspace: `scripts/build.sh` removes helper development state including `service/guide-data`.  Do not run it concurrently with browser/guide tests or a relay using that state.  Stop test processes, build, restart the relay, then run browser tests.  Otherwise a passing change can appear broken because the build deleted the test server's data.

The old Chromium/Node engine matrix needs the supported Linux environment/CI; a macOS syntax check is not an old-engine pass.  Android is built/tested through its supported CI pipeline.  Record the job/commit and actual result.  Do not substitute “not available locally” with “passed”.

Required final evidence:

- Baseline commit and integrated feature commit; exact tested branch.
- All new targeted units and existing affected suites pass; lint and full `npm test` pass.
- TV/editor/phone browser suites pass with relevant logs/screenshots free of secrets.
- Node 0.12 and Chromium 53 compatibility checks run on a supported environment.
- Android protocol and UI/build CI results for the changed revision.
- Build artifact path and package identity; no version bump unless separately instructed.
- On-device checklist: mixed source, show metadata, corrections, date/absolute order, versions, multi-episode playback, next cancellation, subtitles during seek, guide contention, large-list navigation.
- Documentation/changelog/privacy/protocol updates, plus remaining measured limitations.  A missing required gate is reported as outstanding; no “complete” claim based only on a desktop mock.

No application tests are required merely to edit this specification.  When implementation begins, each row is a completion criterion, with a passing test reference or an explicit hardware/manual observation where automation cannot establish the result.
