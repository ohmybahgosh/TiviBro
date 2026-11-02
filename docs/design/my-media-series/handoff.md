# Implementation handoff: complete My media build

This file is the starting prompt and progress ledger template for the implementing model.  It is not evidence that the feature is implemented.  Read the entire [specification](specification.md) and [test matrix](acceptance.md) before changing code.

## Copyable task prompt

> Implement the complete My media movies/TV-show feature specified in `docs/design/my-media-series/specification.md` and tested by `docs/design/my-media-series/acceptance.md`.
>
> The user explicitly wants all features in one build.  Metadata/artwork, date-based episodes, absolute/anime numbering, episode-order mapping, cross-source grouping, versions, merge/unmerge, rename/relink, chapter/manual episode boundaries, watched/resume state, auto-next, remote corrections, web editor bulk controls, and Android browsing/Play on TV are all required.  Milestones are implementation dependencies, not permission to ship a reduced first release.
>
> Read AGENTS.md and docs/ai/GUIDE.md in the chosen checkout.  Verify current branches and working changes before creating an isolated feature worktree.  Keep app code Chromium 53-compatible and helper code ES5/Node 0.12-compatible.  Preserve existing movies, subtitle fixes, authenticated WebDAV, provider browsing and phone compatibility.
>
> Start by checking the current implementation against the specification, report the files/modules to change, then implement dependency-ordered commits with meaningful tests.  Make ordinary implementation decisions autonomously.  Ask only for genuinely missing user information or a scope conflict; do not repeatedly seek approval for work already authorised.
>
> Use synthetic fixtures and local mocks; never put real source credentials, source paths or signed URLs in tests/logs/docs.  Do not contact maintainers, publish a PR, deploy to TV or bump releases unless authorised in the active conversation.  Build the complete reviewable change and report any external verification that remains unavailable.
>
> Update an implementation ledger after each milestone with commit, changed modules, tests actually run and remaining items.  Do not label an unrun test as passing, a planned endpoint as existing, or a fallback as automatic detection.  Finish all in-scope work before reporting completion.

## Workspace baseline and existing contributions

These were observed on 2 November 2026.  Recheck before making integration decisions.

| Worktree | Branch / reviewed HEAD | Purpose |
| --- | --- | --- |
| `/Users/moritz/lg-tv/tivibro-latest` | `media-subtitle-formats` / `d1e7110` | Combined working app with WebDAV/subtitle work; main implementation reference |
| `/Users/moritz/lg-tv/tivibro-subtitles-pr` | `contribute/mkv-subtitle-formats` / `5007df8` | Separate upstream subtitle contribution |
| `/Users/moritz/lg-tv/tivibro-webdav-pr` | `contribute/authenticated-webdav` / `02d2c38` | Separate upstream authenticated WebDAV contribution |
| `/Users/moritz/lg-tv/tivibro-guide-pr` | `contribute/guide-fallback-message` / `ed4e618` | Improved guide fallback message; based on newer upstream |
| `/Users/moritz/lg-tv/tivibro-src` | `my-media` / `63b8b95` | Older worktree; preserve |
| `/Users/moritz/lg-tv/tivibro-pr` | detached / `63b8b95` | Older contribution worktree; preserve |

Origin: `moritzm784/TiviBro`.  Upstream: `ohmybahgosh/TiviBro`.  Existing upstream contributions: [subtitles #27](https://github.com/ohmybahgosh/TiviBro/pull/27), [WebDAV #28](https://github.com/ohmybahgosh/TiviBro/pull/28), [guide fallback message #29](https://github.com/ohmybahgosh/TiviBro/pull/29).  Their current merge state must be checked at implementation time; it is not fixed by this document.

The guide-message PR already exists; do not create it again.  The TV-show feature has not been built.  The combined worktree being ahead in subtitle fixes does not imply it includes latest upstream or guide changes.  Node modules may be shared via symlinks; check before deleting/installing dependencies.

Recommended initial read-only checks:

```sh
git status --short
git branch --show-current
git log -5 --oneline
git remote -v
git worktree list
```

Run in the intended repository.  Fetch when implementing integration, inspect patch equivalence/ancestry and choose a fresh branch/worktree.  Avoid blindly cherry-picking all three contribution branches onto the combined branch, which can duplicate already-present patches.  If upstream has merged a contribution, use that history or a deliberate conflict resolution.  Record the chosen baseline and exactly which extra patches were retained.

## Read these files in this order

1. `AGENTS.md`, `docs/ai/GUIDE.md`, `docs/COMPATIBILITY.md`, package/test scripts.
2. `service/media.js`, `tests/unit/media-service.test.js`: actual discovery/resolve contract, pruning and ID construction.
3. `app/js/mediastore.js`, `app/js/store.js`, `service/kv.js`: legacy storage, resume/favourites, atomic writes and helper fallback.
4. `app/js/media.js`, `app/js/vod.js`, `app/js/views.js`: separate local/provider flow, player callbacks, source resolution and cancellation.
5. `service/media-metadata.js` and its tests: existing user credential, movie match and localisation flow.
6. `app/js/mkvsubs.js`, `app/js/subs.js`, `service/media-stream.js` and their tests: shared authorised stream URL, Range validation, subtitle seek lifecycle.
7. `app/js/phone.js`, `service/companion.js`, Android `proto/Ask.kt`, `proto/Protocol.kt`, `ui/VodTab.kt`, `ui/AppModel.kt`, `tests/android/fake-tv.js`.
8. `app/js/webedit.js`, `service/editor/index.html`, existing media editor tests and user-guide sections.

New modules proposed in the main specification do not exist yet.  Do not report them as reviewed implementation.  Add new app scripts to `app/index.html` in dependency order, with the repository's global/IIFE conventions.  Add helper routes under the existing secret check, not a new LAN listener.

## Key implementation traps

- Flat/mixed folders already work; the problem is episode pruning, insufficient context and unsafe movie heuristics.  A recursion checkbox alone solves none of those.
- Do not collect every file in the app and then paginate the array.  Storage and query are helper-owned.
- A file ID is not a show ID.  A show title is not an identity.  A metadata number needs its type.
- `Episode 02` cannot yield season 1 without evidence.  An absolute episode cannot be assigned a season by counting whatever metadata was fetched.
- Same-title shows on different sources do not automatically merge.  Alternative encodes are not duplicates of the same bytes.
- Existing movie metadata must not be blindly copied onto reclassified episodes.  Old manual/automatic provenance is unknown.
- Missing resume does not mean watched.  Seeking to the end does not prove viewing.
- Cancel resolver callbacks and timers, not just UI elements.  A hidden dialog does not stop a late next episode from starting.
- Multi-episode files have one physical timeline.  Do not infer episode start times by dividing duration by episode count.
- A metadata refresh cannot alter IDs, overwrite user corrections or start playback.
- Existing Android media requests are movie-only.  Capability negotiation must precede new typed/paginated requests.
- An obsolete source scan cannot delete items excluded by a new mode or resurrect a removed source.
- The build script clears helper development state.  Keep build and live relay/guide tests sequential and restart the relay after building.
- Desktop Chromium cannot prove C9 codec/subtitle playback, and modern Node cannot prove Node 0.12 compatibility.

## Suggested small internal interfaces

Use callback style in the helper.  These are proposed boundaries, not mandatory public function names:

```text
Classifier.classify(observation, context, overrides) -> classification + evidence
Library.query(query, callback) -> projected page + cursor + revision
Library.transact(expectedRevision, operations, idempotencyKey, callback)
Library.applyScanBatch(jobId, observations, scopeState, callback)
Library.finishScan(jobId, authoritativeScopeResult, callback)
Metadata.startJob(action, entityHandles, options, callback)
Chapters.inspect(fileSession, limits, callback) -> cancellable probe
Queue.next(currentLogicalItem, sequenceIntent, orderedCandidates) -> decision
```

`Queue.next` returns a decision (`play`, `gapPrompt`, `chooseVersion`, `end`, `unavailable`), not a side-effecting player call.  The session owner resolves the file and rechecks its generation before playback.  This separation makes race tests and all naming-order tests straightforward.

A library transaction applies user overlays to latest observations before publishing indexes.  Scanner output cannot carry authoritative user corrections.  Metadata responses include the expected match revision so stale results are harmless.  Public projection functions explicitly whitelist fields; never serialize a file/source record wholesale to phone/editor.

## Implementation ledger template

Create this in the feature branch under a suitable developer-docs path.  Keep it current, with no synthetic pass claims.

```text
Baseline:
Feature branch/worktree:
Integrated existing patches:
Latest implementation commit:

Milestone 1: Integration baseline          [pending/in progress/done]
Milestone 2: Contracts + fixtures         [pending/in progress/done]
Milestone 3: Storage + migration          [pending/in progress/done]
Milestone 4: Traversal + classifier       [pending/in progress/done]
Milestone 5: Identity + corrections       [pending/in progress/done]
Milestone 6: Metadata + chapters          [pending/in progress/done]
Milestone 7: TV screens                   [pending/in progress/done]
Milestone 8: Playback + progression       [pending/in progress/done]
Milestone 9: Editor + Android             [pending/in progress/done]
Milestone 10: Combined verification       [pending/in progress/done]

Per milestone:
- Commit and changed modules:
- Acceptance IDs covered:
- Commands actually run and result:
- Hardware/CI evidence:
- Unfinished work / concrete blocker:
- Next dependency-ready task:
```

For each milestone mark done only when its stated behaviour and relevant tests exist.  Passing one happy-path test is not completion of its error/migration/cancellation requirements.  Any changed behaviour should update the specification/test expectation explicitly rather than silently diverging.

## Definition of the final handoff

Provide the integrated build artifact, implementation summary, test results, documented limitations and remaining external gates.  Include updated `docs/USER-GUIDE.md`, Unreleased changelog, protocol documentation through the repository's canonical source, privacy text for any new opt-in external requests, and migration recovery notes.  Do not edit generated wiki pages as source or bump release versions.

TV testing should use the configured device alias and current connection instructions discovered locally; do not copy a private IP or credentials into repository docs.  If deployment is authorised, validate the complete build rather than installing an intermediate milestone and implying the whole feature is present.  Preserve user library/settings while testing; do not rescan/remove real sources destructively to satisfy a test.

This specification package is outside the git checkout.  When implementation begins, copy the relevant design/acceptance documents into the feature branch's developer documentation if they should travel with the contribution, replacing machine-specific paths with repository-relative ones.  The current documentation task does not itself open a new PR or deploy anything.
