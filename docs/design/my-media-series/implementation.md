# Implementation ledger

Baseline: `d1e7110`, the combined subtitle and authenticated WebDAV branch.
Feature branch: `feature/my-media-series`.
Worktree: `/Users/moritz/lg-tv/tivibro-series`.

The full specification remains required.  No TV-show UI or playback change is shipped yet.

## Implemented foundations

- Pure ES5 classifier: filename and ancestor evidence, explicit episode coverage, specials, date validation, absolute numbering, structured server candidates and ordered user overrides.
- Immutable ES5 storage primitive: bounded record pages, hash validation, atomic manifest publication, previous-generation recovery, revision conflicts and paginated reads.
- Classification regression suite, real-disk storage/recovery suite and package test registration.
- Specification, acceptance matrix and handoff copied into repository developer documentation.

## Validation

- Classifier: 30 behavioural checks pass.
- Storage: persistence, bounded batches, paging, stale revisions/cursors and corrupt-page recovery pass.
- New helper modules parse with Acorn `ecmaVersion: 5`.
- `npm run lint`: passed.
- Full existing `npm test` run: passed.  New suites were also run directly after their final edits; both passed.
- Old-engine runtime, Android, browser, build and TV checks: not run for these foundations.

## Required remaining work

- Complete classifier validation, movie-folder inference, exclusions and adapter-backed evidence parsing.
- Durable indexed transactions/overlays, migration, idempotency, progress records and storage fault injection.  The current primitive appends pages; it is not yet the complete indexed library.
- Resumable source traversal, scopes, stable identity and duplicate/version grouping.
- Protected routes, app store facade and legacy compatibility adapters.
- Metadata, artwork, matching/order mapping and MKV/MP4 chapter services.
- TV browsing, remote corrections, merge/unmerge/relink and watched state.
- Playback session state machine and cancellable progression.
- Web editor and Android protocol/screens.
- User guide/privacy/protocol updates, full verification and integrated build.

No production reader or scanner uses the new modules yet.  Existing saved libraries remain on their current code path while migration and integration are implemented.
