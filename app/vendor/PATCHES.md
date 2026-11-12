# Vendor patches

`mpegts.js` (1.8.0) has four small null checks added, so events that arrive from the demux worker
after a player was destroyed (common when zapping fast or reconnecting) are ignored instead of
throwing "Cannot read properties of null (reading 'notifyBufferedPositionChanged')":

- `MEDIA_SEGMENT` / `INIT_SEGMENT` handlers: `e._mse_controller&&…`, `e._loading_controller&&…`, `e._config&&…`
- `_onMSEUpdateEnd` (two copies): `this._config&&…`, `this._loading_controller&&…`

Closed captions: `parseH264Payload` hands every H.264 SEI that carries "GA94" caption data (ATSC A/53,
CEA-608) to `onPESPrivateData` as `{ pid: -608, data, pts }`, a copy of just that NAL, so it reaches the
page as `PES_PRIVATE_DATA_ARRIVED` (from the worker too).  `app/js/captions.js` decodes it.

Worker URL made once (issue #52): mpegts builds its demux worker with webworkify, which turned the whole
library's source into a new Blob and Blob URL on every player and never revoked it.  Every channel change
left one behind, in the browser's blob storage where the app's own memory figures don't see it, so hours of
zapping on a TV with little memory ran it out.  The URL is now made the first time and kept in
`self.__tbWorkerURL<module>`, and every later worker starts from it (mpegts never revokes `objectURL`).

Letting go of a stalled stream: `FetchStreamLoader.abort` never aborted a fetch that was buffering on Chrome
(it waited for the next chunk to cancel it), and Chrome 53 (webOS 4) has no AbortController at all.  So a
stream that had stopped sending, the usual reason to reconnect, kept its connection to the provider open
until the helper's idle timeout, and the reconnect needed a second connection (refused by providers that
allow one).  The loader now keeps its reader (`_reader`, set in `open`) and `abort` cancels it whenever it
doesn't call the AbortController; `_pump` stops at once after an abort (no "complete" or error after it).

Letting go after the browser dropped the buffers (issue #70): `MSEController.flush` read `buffered` from a
SourceBuffer the browser had already removed and threw, so the player's unload stopped halfway and its stream kept
loading, each piece throwing again.  `flush` now catches per buffer, `_needCleanupSourceBuffer` and
`_doCleanupSourceBuffer` skip a buffer whose `buffered` can't be read, and `Transmuxer._onWorkerMessage` drops a
message that arrives after destroy (`!this._emitter`, "Cannot read property 'emit' of null").

A late "updateend" after shutdown (issue #74): when the browser had removed a SourceBuffer, the MediaSource is "closed" and
`MSEController.shutdown` skipped taking the SourceBuffer listeners off along with `removeSourceBuffer`.  A queued "updateend" then ran
`_onSourceBufferUpdateEnd` on the emptied queues ("Cannot read property 'length' of null").  The listeners now come off whatever the
MediaSource's state, and `_onSourceBufferUpdateEnd` returns at once when the controller has been shut down or destroyed.

A big jump in the sound's timestamps (issue #81): `_remuxAudio` filled any gap in the sound with silent frames, one per
21 ms, and added them with `T.push.apply(T,C)`.  A channel whose sound timestamps jumped by hours made hundreds of thousands of
frames and threw "Maximum call stack size exceeded" (shown as "ts engine net error: Exception").  Gaps are now filled only up to
10 s (`s<=1e4`); a bigger jump is joined up like on Safari, and the frames are added with `concat`.

Re-apply after upgrading mpegts.js.  `hls.min.js` (1.5.20) is unmodified.

## qrcode.js

qrcode-generator 2.0.4 by Kazuhiko Arase (MIT), `dist/qrcode.js` from npm, unchanged.  Draws the QR code on the TV's first-run tour that opens the web editor on a phone.
