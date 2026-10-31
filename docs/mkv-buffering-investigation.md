# Subtitle extraction and buffering

The provider-only diagnosis in the original handoff is not established. Bare curl
failures demonstrate provider instability but do not exclude additional contention
from the app. A single competing request does not model continuous extraction.

Confirmed code defects in 1df8b4a:

- Every indexed cluster was downloaded in full, including its video/audio payload,
  back-to-back across the entire file. Sorting by distance did not limit extraction.
- Cancellation only ignored responses; it did not stop the network transfer.
- HTTP 200 was accepted for Range requests, allowing a full-file download when a
  server ignored Range.
- The Cues read requested 1 MB irrespective of the index's actual size.

The change uses abortable XHR (compatible with Chromium 53), validates status,
Content-Range and response length, reads the exact Cues size, and skips media
payloads using EBML sizes. CueRelativePosition is used when available to jump
straight to indexed blocks; otherwise it walks element headers in small windows.
Only S_TEXT/UTF8 tracks are extracted.

Extraction selects clusters indexed within 30 seconds behind / 60 seconds ahead
of the current playhead and follows timeupdate. Each request waits for eight
seconds of playback buffer (with an end-of-file exception); a waiting event aborts
an active request and waits for buffer recovery before retrying. Seeking/destroying
cancels pending work. The cue cache still survives reconnects.

Verification:

- 32 subtitle tests pass, including cancellation, buffer recovery, ignored/mismatched
  Range responses, relative positions, moving playback window, and cache replay.
- A synthetic cluster with a 2 MB video block transfers 4,139 bytes instead of
  2,097,200 bytes and produces the same subtitle timing/text. This measures the
  cluster reader, excluding the initial file header and Cues metadata reads.
- Player tests pass; lint passes; minified IPK build passes.
- Full unit suite reaches the relay tests then fails with listen EPERM on
  127.0.0.1 in this sandbox. It has NOT been verified as fully passing here.
- TV debugging endpoint 192.168.178.65:9998 was unreachable in this session.
  The package has NOT been installed or verified on-device.

Remaining validation: install dist/app.tivibro.tv_0.6.0_all.ipk on device `tv`,
check subtitles during startup/resume/seek/reconnect, and observe a sustained
playback session alongside buffer levels and request traffic. In particular,
confirm this TV reports enough buffer for the eight-second gate. Header-only
walking still requires multiple requests on files without CueRelativePosition;
this change cannot guarantee compatibility with a provider that rejects all
concurrent requests. Do not label the observed TV buffering fixed before testing.
