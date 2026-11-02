// Small synthetic Matroska files for subtitle unit and browser tests.  No real media.
function idBytes(hex) { const b = []; for (let i = 0; i < hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16)); return b; }
function sizeByte(n) {
  for (let len = 1; len <= 8; len++) {
    if (n <= Math.pow(2, 7 * len) - 1) {
      const bytes = [];
      let v = n;
      for (let i = len - 1; i >= 0; i--) { bytes[i] = v & 0xFF; v = Math.floor(v / 256); }
      bytes[0] |= (0x80 >> (len - 1));
      return bytes;
    }
  }
  throw new Error('size too large for fixture helper');
}
function strBytes(s) { return Array.from(s).map(c => c.charCodeAt(0)); }
function el(hexId, contentBytes) { return idBytes(hexId).concat(sizeByte(contentBytes.length)).concat(contentBytes); }
function trackEntry(num, type, codecId, lang, forced) {
  let content = [].concat(el('D7', [num]), el('83', [type]), el('86', strBytes(codecId)));
  if (lang) content = content.concat(el('22B59C', strBytes(lang)));
  if (forced) content = content.concat(el('55AA', [1]));
  return el('AE', content);
}
function u8(arr) { return Uint8Array.from(arr); }
function uintBytes(n) { if (n === 0) return [0]; const b = []; let v = n; while (v > 0) { b.unshift(v & 0xFF); v = Math.floor(v / 256); } return b; }
function seek(idHex, pos) { return el('4DBB', [].concat(el('53AB', idBytes(idHex)), el('53AC', uintBytes(pos)))); }
function cuePoint(time, track, clusterPos) { return el('BB', [].concat(el('B3', uintBytes(time)), el('B7', [].concat(el('F7', uintBytes(track)), el('F1', uintBytes(clusterPos)))))); }
function trackVint(n) { return [0x80 | n]; }
function i16be(n) { if (n < 0) n = 0x10000 + n; return [(n >> 8) & 0xFF, n & 0xFF]; }
function blockHeader(track, relTimecode, flags) { return trackVint(track).concat(i16be(relTimecode), [flags]); }
function blockGroupEl(track, relTimecode, duration, text) {
  const blockContent = blockHeader(track, relTimecode, 0x00).concat(strBytes(text));
  return el('A0', [].concat(el('A1', blockContent), el('9B', uintBytes(duration))));
}
function simpleBlockEl(track, relTimecode, flags, text) { return el('A3', blockHeader(track, relTimecode, flags).concat(strBytes(text))); }
// Fixed-width (4-byte) uint encoding: length is independent of value, so a SeekHead/Cues
// entry's own byte length can be computed before the position value it will hold is known.
function uintBytesFixed(n) { const b = []; let v = n; for (let i = 0; i < 4; i++) { b.unshift(v & 0xFF); v = Math.floor(v / 256); } return b; }
function seekFixed(idHex, pos) { return el('4DBB', [].concat(el('53AB', idBytes(idHex)), el('53AC', uintBytesFixed(pos)))); }
function cuePointFixed(time, track, clusterPos) { return el('BB', [].concat(el('B3', uintBytes(time)), el('B7', [].concat(el('F7', uintBytes(track)), el('F1', uintBytesFixed(clusterPos)))))); }

// A complete synthetic MKV: EBML header + Segment{Info, Tracks, SeekHead->Cues, Cues->Cluster}.
// opts.subtitleTrack: {number, lang} or null (no subtitle track at all).
// opts.cuesIndexesSubtitle: whether Cues' CuePoint references the subtitle track (true) or
//   only the video track (false) -- the "Cues doesn't index the subtitle track" case.
function buildMkv(opts) {
  const ebmlHeader = el('1A45DFA3', []);
  const infoEl = el('1549A966', el('2AD7B1', uintBytes(1000000)));
  let tracksContent = trackEntry(1, 1, 'V_MPEG4/ISO/AVC', '', false);
  if (opts.subtitleTrack) tracksContent = tracksContent.concat(trackEntry(opts.subtitleTrack.number, 17, opts.subtitleTrack.codec || 'S_TEXT/UTF8', opts.subtitleTrack.lang || '', false));
  const tracksEl = el('1654AE6B', tracksContent);
  const preSeekLen = infoEl.length + tracksEl.length;
  const seekEntryLen = seekFixed('1C53BB6B', 0).length; // fixed-width: same length for any value
  const seekHeadFullLen = idBytes('114D9B74').length + sizeByte(seekEntryLen).length + seekEntryLen; // SeekHead's own id+size header + its one Seek entry
  const cuesOffset = preSeekLen + seekHeadFullLen; // Cues sits right after the whole SeekHead element, not just its inner Seek entry
  const seekHeadEl = el('114D9B74', seekFixed('1C53BB6B', cuesOffset));

  const cuesTrack = (opts.cuesIndexesSubtitle && opts.subtitleTrack) ? opts.subtitleTrack.number : 1;
  const cuePointLen = cuePointFixed(0, cuesTrack, 0).length; // fixed-width: same length for any value
  const padding = opts.indexPadding ? el('EC', Array(opts.indexPadding).fill(0)) : [];
  const cuesElLenSoFar = el('1C53BB6B', cuePointFixed(0, cuesTrack, 0).concat(padding)).length;
  const clusterPos = cuesOffset + cuesElLenSoFar;
  const cuesEl = el('1C53BB6B', cuePointFixed(0, cuesTrack, clusterPos).concat(padding));

  let clusterContent = el('E7', uintBytes(1000)); // cluster timecode
  if (opts.subtitleTrack) clusterContent = clusterContent.concat(blockGroupEl(opts.subtitleTrack.number, 0, opts.cueDuration || 2000, opts.cueText || 'Hi there'));
  const clusterEl = el('1F43B675', clusterContent);

  const segmentContent = [].concat(infoEl, tracksEl, seekHeadEl, cuesEl, clusterEl);
  const segmentEl = el('18538067', segmentContent);
  return Uint8Array.from([].concat(ebmlHeader, segmentEl));
}

module.exports = { idBytes, sizeByte, strBytes, el, trackEntry, u8, uintBytes, seek, cuePoint, trackVint, i16be, blockHeader, blockGroupEl, simpleBlockEl, uintBytesFixed, seekFixed, cuePointFixed, buildMkv };
