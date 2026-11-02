# Vendor patches

`mpegts.js` (1.8.0) has four small null checks added, so events that arrive from the demux worker
after a player was destroyed (common when zapping fast or reconnecting) are ignored instead of
throwing "Cannot read properties of null (reading 'notifyBufferedPositionChanged')":

- `MEDIA_SEGMENT` / `INIT_SEGMENT` handlers: `e._mse_controller&&…`, `e._loading_controller&&…`, `e._config&&…`
- `_onMSEUpdateEnd` (two copies): `this._config&&…`, `this._loading_controller&&…`

Closed captions: `parseH264Payload` hands every H.264 SEI that carries "GA94" caption data (ATSC A/53,
CEA-608) to `onPESPrivateData` as `{ pid: -608, data, pts }`, a copy of just that NAL, so it reaches the
page as `PES_PRIVATE_DATA_ARRIVED` (from the worker too).  `app/js/captions.js` decodes it.

Re-apply after upgrading mpegts.js.  `hls.min.js` (1.5.20) is unmodified.

## qrcode.js

qrcode-generator 2.0.4 by Kazuhiko Arase (MIT), `dist/qrcode.js` from npm, unchanged.  Draws the QR code on the TV's first-run tour that opens the web editor on a phone.
