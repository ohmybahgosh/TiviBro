/* Turning a provider's answer into TiviBro's channel list, shared by the app (source.js) and the helper
   (service/live.js, which downloads and shapes a big list on the TV so the app never holds the
   provider's whole answer: a 180,000-channel list took the app to about 270 MB while it loaded).
   Both must give the same channel keys, so a playlist's edits keep working either way.  Plain ES5. */
var PlShape = (function () {
  'use strict';
  // The same as U.hash in util.js (the M3U channel and group keys).
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(36);
  }

  // Xtream Codes: get_live_categories and get_live_streams.
  function xtream(cats, streams) {
    cats = Array.isArray(cats) ? cats : []; streams = Array.isArray(streams) ? streams : [];
    var groups = cats.map(function (c) { return { id: 'x' + c.category_id, name: c.category_name || 'Group' }; });
    var known = {};
    groups.forEach(function (g) { known[g.id] = 1; });
    var chans = new Array(streams.length), n = 0;
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      var gid = 'x' + s.category_id;
      if (!known[gid]) { known[gid] = 1; groups.push({ id: gid, name: 'Other' }); }
      chans[n++] = {
        k: 'x' + s.stream_id, id: s.stream_id, n: s.name || '', g: gid,
        logo: s.stream_icon || '', num: +s.num || 0, epg: s.epg_channel_id || '',
        arch: +s.tv_archive ? (+s.tv_archive_duration || 3) : 0
      };
    }
    chans.length = n;
    return { groups: groups, channels: chans };
  }

  // Single pass line parser.  No regex per attribute; one regex over the EXTINF line.
  var ATTR = /([a-zA-Z0-9\-_]+)="([^"]*)"/g;
  function parseM3U(text) {
    var lines = text.split(/\r?\n/);
    var groups = [], gmap = {}, chans = [], cur = null, epgUrl = '';
    var head = lines[0] || '';
    var m = head.match(/(?:url-tvg|x-tvg-url)="([^"]+)"/);
    if (m) epgUrl = m[1].split(',')[0];
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!L) continue;
      if (L.charCodeAt(0) === 35) {          // '#'
        if (L.indexOf('#EXTINF') === 0) {
          cur = { attrs: {}, name: '' };
          var comma = L.lastIndexOf('",');
          comma = comma >= 0 ? comma + 1 : L.indexOf(',');
          cur.name = L.slice(comma + 1).trim();
          var a, meta = L.slice(0, comma);
          ATTR.lastIndex = 0;
          while ((a = ATTR.exec(meta))) cur.attrs[a[1].toLowerCase()] = a[2];
        } else if (L.indexOf('#EXTGRP:') === 0 && cur) {
          cur.attrs['group-title'] = cur.attrs['group-title'] || L.slice(8).trim();
        }
        continue;
      }
      if (cur) {
        var url = L.trim();
        var gname = cur.attrs['group-title'] || 'Ungrouped';
        var gid = gmap[gname];
        if (!gid) { gid = 'm' + hash(gname); gmap[gname] = gid; groups.push({ id: gid, name: gname }); }
        var key = 'm' + hash((cur.attrs['tvg-id'] || '') + '|' + (cur.attrs['tvg-name'] || cur.name) + '|' + gname);
        chans.push({
          k: key, id: key, n: cur.name || cur.attrs['tvg-name'] || 'Channel', g: gid,
          logo: cur.attrs['tvg-logo'] || '', num: +cur.attrs['tvg-chno'] || 0,
          epg: cur.attrs['tvg-id'] || '', url: url,
          arch: cur.attrs['catchup'] || cur.attrs['catchup-type'] || cur.attrs['tvg-rec'] ? (+cur.attrs['catchup-days'] || +cur.attrs['tvg-rec'] || 3) : 0,
          cu: cur.attrs['catchup'] || cur.attrs['catchup-type'] || '', cus: cur.attrs['catchup-source'] || ''
        });
        cur = null;
      }
    }
    // Duplicate keys (same name+id in the same group) get a suffix so edits stay unique.
    var seen = {};
    for (var j = 0; j < chans.length; j++) {
      var c = chans[j];
      if (seen[c.k]) { c.k = c.k + '_' + (seen[c.k]++); c.id = c.k; } else seen[c.k] = 1;
    }
    return { groups: groups, channels: chans, epgUrl: epgUrl };
  }

  return { hash: hash, xtream: xtream, parseM3U: parseM3U };
})();
if (typeof module !== 'undefined') module.exports = PlShape;
