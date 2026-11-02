/* Closed captions (CEA-608) for live TV.
   US channels carry captions inside the video itself: H.264 SEI messages with "GA94" caption data
   (ATSC A/53).  hls.js reads them by itself; for MPEG-TS (most IPTV) the patched mpegts.js hands every
   caption SEI over as PES private data with pid -608 (vendor/PATCHES.md), and this decodes it.

   Captions.feed(seiBytes, ptsMs): the SEI as it came (Annex B or not), with its presentation time.
   Decoding happens in time order (B-frames send captions out of order), into "screens": what CC1
   shows from a time on.  Captions.at(t) is the screen to show at video time t.

   CEA-608 in short: pairs of bytes with odd parity.  0x10-0x1F as the first byte is a control code
   (sent twice, the copy ignored); the rest is text.  Three styles: pop-on (written off screen, then
   swapped in whole), roll-up (lines scroll up from a base row) and paint-on (written in place). */
var Captions = (function () {
  var ROWS = 15, COLS = 32;
  // Characters where 608 differs from ASCII.
  var STD = { 0x2a: 'á', 0x5c: 'é', 0x5e: 'í', 0x5f: 'ó', 0x60: 'ú', 0x7b: 'ç', 0x7c: '÷', 0x7d: 'Ñ', 0x7e: 'ñ', 0x7f: '█' };
  var SPECIAL = ['®', '°', '½', '¿', '™', '¢', '£', '♪', 'à', ' ', 'è', 'â', 'ê', 'î', 'ô', 'û'];
  var EXT1 = ['Á', 'É', 'Ó', 'Ú', 'Ü', 'ü', '‘', '¡', '*', '’', '—', '©', '℠', '•', '“', '”', 'À', 'Â', 'Ç', 'È', 'Ê', 'Ë', 'ë', 'Î', 'Ï', 'ï', 'Ô', 'Ù', 'ù', 'Û', '«', '»'];
  var EXT2 = ['Ã', 'ã', 'Í', 'Ì', 'ì', 'Ò', 'ò', 'Õ', 'õ', '{', '}', '\\', '^', '_', '|', '~', 'Ä', 'ä', 'Ö', 'ö', 'ß', '¥', '¤', '¦', 'Å', 'å', 'Ø', 'ø', '┌', '┐', '└', '┘'];
  // Preamble address codes: first byte (channel bit cleared) and whether the second is 0x60+ give the row.
  var PAC_ROW = { 0x11: [1, 2], 0x12: [3, 4], 0x15: [5, 6], 0x16: [7, 8], 0x17: [9, 10], 0x10: [11, 11], 0x13: [12, 13], 0x14: [14, 15] };

  function blank() { var m = []; for (var r = 0; r <= ROWS; r++) m.push(null); return m; }
  function Decoder() {
    this.disp = blank(); this.hidden = blank();
    this.mode = 'pop'; this.rollRows = 2; this.row = ROWS; this.col = 0;
    this.chan = 1; this.textMode = false; this.last = 0; this.screens = []; this.changed = false;
    this.pend = []; this.maxPts = -1;
  }
  Decoder.prototype.mem = function () { return this.mode === 'pop' ? this.hidden : this.disp; };
  Decoder.prototype.put = function (ch) {
    var m = this.mem(), r = this.row;
    if (!m[r]) m[r] = { col: this.col, chars: [] };
    var line = m[r], at = this.col - line.col;
    if (at < 0) { for (var k = 0; k < -at; k++) line.chars.unshift(' '); line.col = this.col; at = 0; }
    while (line.chars.length < at) line.chars.push(' ');
    line.chars[at] = ch;
    if (this.col < COLS - 1) this.col++;
    if (this.mode !== 'pop') this.changed = true;
  };
  Decoder.prototype.backspace = function () {
    var m = this.mem(), line = m[this.row];
    if (this.col > 0) this.col--;
    if (line) { var at = this.col - line.col; if (at >= 0 && at < line.chars.length) line.chars.splice(at, 1); }
    if (this.mode !== 'pop') this.changed = true;
  };
  Decoder.prototype.roll = function () {
    var top = this.row - this.rollRows + 1;
    for (var r = Math.max(1, top); r < this.row; r++) this.disp[r] = this.disp[r + 1];
    for (r = 1; r < top; r++) this.disp[r] = null;
    this.disp[this.row] = null; this.col = 0; this.changed = true;
  };
  Decoder.prototype.snapshot = function (t) {
    var lines = [];
    for (var r = 1; r <= ROWS; r++) {
      var l = this.disp[r];
      if (l) { var s = l.chars.join('').replace(/\s+$/, ''), lead = s.length - s.replace(/^\s+/, '').length; if (s.trim()) lines.push({ row: r, col: l.col + lead, text: s.slice(lead) }); }
    }
    var prev = this.screens[this.screens.length - 1];
    var key = JSON.stringify(lines);
    if (prev && prev.key === key) return;
    this.screens.push({ t: t, lines: lines, key: key });
    if (this.screens.length > 400) this.screens.splice(0, this.screens.length - 300);
  };
  // One byte pair (parity stripped) at time t.
  Decoder.prototype.pair = function (a, b, t) {
    if (!a && !b) return;
    if (a >= 0x10 && a <= 0x1f) {
      var code = (a << 8) | b;
      if (code === this.last) { this.last = 0; return; }      // the repeated copy
      this.last = code;
      var ch = a & 0x08 ? 2 : 1, c = a & 0xf7;
      // Miscellaneous commands carry the channel too; text after them belongs to it.
      if ((c === 0x14 || c === 0x15) && b >= 0x20 && b <= 0x2f) { this.chan = ch; if (ch === 1) this.command(b, t); return; }
      this.chan = ch;
      if (ch !== 1 || this.textMode) return;
      if (c === 0x17 && b >= 0x21 && b <= 0x23) { for (var i = 0; i < b - 0x20; i++) this.put(' '); return; }   // tab offset
      if (c === 0x11 && b >= 0x30 && b <= 0x3f) { this.put(SPECIAL[b - 0x30]); return; }
      if (c === 0x11 && b >= 0x20 && b <= 0x2f) { this.put(' '); return; }                                   // mid-row style: a space
      if ((c === 0x12 || c === 0x13) && b >= 0x20 && b <= 0x3f) { this.backspace(); this.put((c === 0x12 ? EXT1 : EXT2)[b - 0x20]); return; }
      if (b >= 0x40 && b <= 0x7f && PAC_ROW[c]) {
        var row = PAC_ROW[c][b >= 0x60 ? 1 : 0];
        if (this.mode === 'roll') {
          if (row !== this.row) {
            // A new base row moves what is on screen with it.
            var lines = []; for (var r = this.row - this.rollRows + 1; r <= this.row; r++) lines.push(r >= 1 ? this.disp[r] : null);
            this.disp = blank();
            for (var j = 0; j < lines.length; j++) { var to = row - lines.length + 1 + j; if (to >= 1) this.disp[to] = lines[j]; }
            this.changed = true;
          }
        }
        this.row = row;
        this.col = b & 0x10 ? ((b & 0x0e) >> 1) * 4 : 0;
        if (this.mode === 'roll') { var ln = this.disp[this.row]; if (ln && ln.chars.length) this.col = ln.col + ln.chars.length; }
        return;
      }
      return;
    }
    if (this.chan !== 1 || this.textMode) return;
    if (a >= 0x20) this.put(STD[a] || String.fromCharCode(a));
    if (b >= 0x20) this.put(STD[b] || String.fromCharCode(b));
  };
  Decoder.prototype.command = function (b, t) {
    switch (b) {
      case 0x20: this.mode = 'pop'; this.textMode = false; break;                                       // RCL
      case 0x21: this.backspace(); break;                                                               // BS
      case 0x24: { var l = this.mem()[this.row]; if (l) { var at = this.col - l.col; if (at >= 0) l.chars.length = at; } if (this.mode !== 'pop') this.changed = true; break; }   // DER
      case 0x25: case 0x26: case 0x27:                                                                  // RU2 to RU4
        if (this.mode !== 'roll') { this.disp = blank(); this.hidden = blank(); this.row = ROWS; }
        this.mode = 'roll'; this.rollRows = b - 0x23; this.textMode = false; this.col = 0; this.changed = true; break;
      case 0x29: this.mode = 'paint'; this.textMode = false; break;                                     // RDC
      case 0x2a: case 0x2b: this.textMode = true; break;                                                // TR, RTD: text service, not captions
      case 0x2c: this.disp = blank(); this.changed = true; break;                                       // EDM
      case 0x2d: if (this.mode === 'roll') this.roll(); else { if (this.row < ROWS) this.row++; this.col = 0; } break;   // CR
      case 0x2e: this.hidden = blank(); break;                                                          // ENM
      case 0x2f: { var d = this.disp; this.disp = this.hidden; this.hidden = d; this.mode = 'pop'; this.changed = true; break; }   // EOC
    }
  };
  Decoder.prototype.flushChanged = function (t) { if (this.changed) { this.changed = false; this.snapshot(t); } };

  /* The SEI: drop emulation prevention bytes, walk the messages, take user_data_registered_itu_t_t35
     with "GA94" and type 3 (cc_data), keep field 1's 608 pairs (CC1 and CC2). */
  function pairsOf(sei) {
    var b = sei, n = b.length, out = [], i;
    if (n > 4 && b[0] === 0 && b[1] === 0 && b[2] === 1) i = 3;
    else if (n > 5 && b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 1) i = 4;
    else if ((b[0] & 0x9f) === 6) i = 0;                       // a bare NAL
    else if (n > 5 && (b[4] & 0x9f) === 6) i = 4;              // length-prefixed (AVC1)
    else return out;
    if ((b[i] & 0x1f) !== 6) return out;
    var rb = [];
    for (var k = i + 1, z = 0; k < n; k++) {
      if (z >= 2 && b[k] === 3) { z = 0; continue; }
      rb.push(b[k]); z = b[k] === 0 ? z + 1 : 0;
    }
    var p = 0;
    while (p + 2 < rb.length) {
      var type = 0, size = 0;
      while (rb[p] === 0xff) { type += 255; p++; } type += rb[p++];
      while (rb[p] === 0xff) { size += 255; p++; } size += rb[p++];
      if (p + size > rb.length) break;
      if (type === 4 && size >= 10 && rb[p] === 0xb5 && rb[p + 1] === 0x00 && rb[p + 2] === 0x31 &&
          rb[p + 3] === 0x47 && rb[p + 4] === 0x41 && rb[p + 5] === 0x39 && rb[p + 6] === 0x34 && rb[p + 7] === 0x03) {
        var count = rb[p + 8] & 0x1f, q = p + 10;
        for (var c = 0; c < count && q + 2 < p + size; c++, q += 3) {
          var h = rb[q], valid = h & 0x04, kind = h & 0x03;
          if (valid && kind === 0) out.push([rb[q + 1] & 0x7f, rb[q + 2] & 0x7f]);
        }
      }
      p += size;
      if (rb[p] === 0x80) break;                // rbsp trailing bits
    }
    return out;
  }

  /* One stream's captions.  B-frames: captions arrive in decode order, so they wait a moment and are
     decoded in presentation order. */
  var HOLD = 600, STALE = 15000, FLICKER = 350;
  function create() {
    var d = new Decoder(), lastFeed = -Infinity;
    function drain(upto) {
      d.pend.sort(function (x, y) { return x.t - y.t; });
      while (d.pend.length && d.pend[0].t <= upto) {
        var e = d.pend.shift();
        for (var i = 0; i < e.pairs.length; i++) d.pair(e.pairs[i][0], e.pairs[i][1], e.t);
        d.flushChanged(e.t);
      }
    }
    var api = {
      seen: false,
      feed: function (sei, t) {
        var pairs = pairsOf(sei);
        if (!pairs.length || t == null || isNaN(t)) return 0;
        // The stream's clock jumped back (a reconnect, a looped clip, a wrap): start again.
        if (t < d.maxPts - 5000) { d = new Decoder(); }
        api.seen = true; lastFeed = t;
        d.pend.push({ t: t, pairs: pairs });
        if (t > d.maxPts) d.maxPts = t;
        drain(d.maxPts - HOLD);
        return pairs.length;
      },
      flush: function () { drain(Infinity); },
      /* What to show at video time t (ms): the lines, or null.  Pop-on captions are cleared just
         before the next one is swapped in; that blink is skipped.  Nothing for a while (the channel
         stopped sending captions) clears the screen. */
      at: function (t) {
        var s = d.screens, lo = 0, hi = s.length - 1, i = -1;
        if (t > lastFeed + STALE) return null;
        while (lo <= hi) { var mid = (lo + hi) >> 1; if (s[mid].t <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
        if (i < 0) return null;
        var cur = s[i];
        if (!cur.lines.length && i > 0 && s[i + 1] && s[i + 1].t - cur.t < FLICKER) cur = s[i - 1];
        return cur;
      },
      // Forget what's past, so a long evening doesn't grow the list.
      trim: function (t) { var s = d.screens, i = 0; while (i < s.length - 2 && s[i + 1].t <= t) i++; if (i > 0) s.splice(0, i); },
      get screens() { return d.screens; }
    };
    return api;
  }

  return { create: create, _test: { pairsOf: pairsOf, Decoder: Decoder } };
})();
if (typeof module !== 'undefined') module.exports = Captions;
