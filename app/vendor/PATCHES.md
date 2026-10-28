# Vendor patches

`mpegts.js` (1.8.0) has four small null checks added, so events that arrive from the demux worker
after a player was destroyed (common when zapping fast or reconnecting) are ignored instead of
throwing "Cannot read properties of null (reading 'notifyBufferedPositionChanged')":

- `MEDIA_SEGMENT` / `INIT_SEGMENT` handlers: `e._mse_controller&&…`, `e._loading_controller&&…`, `e._config&&…`
- `_onMSEUpdateEnd` (two copies): `this._config&&…`, `this._loading_controller&&…`

Re-apply after upgrading mpegts.js.  `hls.min.js` (1.5.20) is unmodified.
