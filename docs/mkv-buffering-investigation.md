# MKV subtitles: on-device investigation and fix

## Findings (2026-11-01, LG C9 / webOS 4.5)

The provider-only diagnosis in the original handoff was premature. The TV showed
network-error reconnects roughly every 36 seconds despite about 30 seconds of
buffered video. Reducing cluster downloads alone did not resolve that behavior.

Stopping subtitle network requests left playback running smoothly for about two
minutes. A single request through the original movie entry URL was then followed
by another video error about 34 seconds later. That URL redirects to a tokenized
stream endpoint. Opening the entry repeatedly creates conflicting provider
sessions; the observed delay is consistent with provider session enforcement.
The exact server-side enforcement implementation is not observable here.

Reusing a separately resolved subtitle URL was insufficient: that session itself
became invalid. Sharing the *same* resolved URL between native video playback and
subtitle requests eliminated the observed recurring errors during testing.

A separate rendering problem was confirmed: the extracted Dutch track was in
`showing` mode and contained a cue spanning the current video time, but activeCues
was empty and its source-less HTML track element had readyState 3 (ERROR). A DOM
overlay rendering the same cue was immediately visible to the user.

## Implementation

- Native MKV startup obtains the header and final redirected URL once, then gives
  that URL to the native player and all subtitle requests. Metadata failure falls
  back to normal native playback. A cancelled extractor cannot start old playback.
- Track/index discovery starts immediately; only ongoing cue reads wait for two seconds of buffer.
  Discovery on the installed build took **881 ms** in the observed session.
- The movie subtitle menu is always present, shows discovery/unavailable status,
  and refreshes an open discovery menu when tracks arrive.
- Extracted cues render through a DOM overlay keyed to playback time and selected
  text tracks, avoiding the broken native renderer. Track selection survives seek
  and engine teardown. Changing the selection also updates paused captions.
- The earlier sparse reads, strict Range checks, cancellation and cue cache remain.
  A synthetic 2 MB media cluster requires 4,139 bytes to extract its subtitle.

## Verification

- Full unit suite passed outside the sandbox (the sandbox rejected OS uptime in
  a helper test). Additional subtitle and native-player integration tests pass.
- Lint and minified package build pass.
- Installed on device `tv`; resumed the user's movie. Captions rendered in the
  DOM and provider entry request count remained one during ongoing extraction.
- Final installed build: 95 seconds observed, 994 ms track discovery, 70 subtitle
  requests, one provider entry request, no failed requests or video errors.
- User confirmed: **"subtitle visible, playback smooth"**.
- Sustained playback and seeking were observed without the recurring video-error
  loop. Seek-related waiting events and cancelled cue requests are expected.

The diagnosis is based on this provider/title/device. It does not establish that
all provider outages or every MKV subtitle format are fixed. Only indexed UTF-8
subtitle tracks are supported; no scan of unindexed subtitle streams is added.
