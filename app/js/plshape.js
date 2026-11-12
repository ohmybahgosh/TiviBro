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
      if (+s.is_adult) chans[n - 1].adult = 1;           // the provider's own adult flag (filter.js)
    }
    chans.length = n;
    return { groups: groups, channels: chans };
  }

  /* Movies and shows in an M3U list.  Many providers hand out one M3U link with their whole film and
     series library in it as entries (one had 2,775 channels and 307,413 movies and episodes, 93 MB,
     issue #26).  With { vod: true } (the network helper, service/live.js) those entries become TiviBro's
     Movies and Shows instead of channels: a movie is a link to a file, or to /movie/; a show's episode
     is a link to /series/, or a file named like "Show S01 E02".  The helper keeps them on the TV's
     storage (service/vod.js) and the app asks for them as it does for an Xtream login's.
     Without it (the app reading a list itself), a list of more than BIG entries keeps its live channels
     and counts the rest (vodSkipped); a smaller one is kept whole, with its movies as channels. */
  var BIG = 100000;
  var VOD = /\/(movie|movies|series)\/|\.(mp4|mkv|avi|mov|m4v)(\?|$)/i;
  var SERIES_URL = /\/series\//i, EPISODE = /^(.*?)[\s._-]*\bS(\d{1,3})[\s._-]*E(\d{1,4})\b/i, YEAR = /\((\d{4})\)\s*$/;
  function count(text, what) { var n = 0, i = -1; while ((i = text.indexOf(what, i + 1)) >= 0) n++; return n; }

  /* The collected library: compact rows the way service/vod.js keeps an Xtream list, and each title's
     link split into a shared prefix and its last part (a library's links differ only in the file name,
     so 300,000 of them take a few MB, not 25).
       movie  rows: [id, name, cover, rating, ext, cat, added]   urls.m[id] = [prefix, rest]
       series rows: [id, name, cover, plot, rating, year, cat, added]   (a show is its name in its group:
                    the dubbed and the subtitled copy in two groups are two shows)
                    urls.s[id] = [[season, episode, prefix, rest], ...] in order */
  function library() {
    var L = { movie: { rows: [], cats: [], cmap: {} }, series: { rows: [], cats: [], cmap: {} }, urls: { p: [], pmap: {}, m: {}, s: {} }, seen: {}, sIndex: {} };
    function cat(k, name) {
      var b = L[k], id = b.cmap[name];
      if (!id) { id = 'c' + hash(k + '|' + name); b.cmap[name] = id; b.cats.push({ id: id, name: name }); }
      return id;
    }
    function split(url) {
      var i = url.lastIndexOf('/') + 1, pre = url.slice(0, i), pi = L.urls.pmap[pre];
      if (pi == null) { pi = L.urls.p.length; L.urls.p.push(pre); L.urls.pmap[pre] = pi; }
      return [pi, url.slice(i)];
    }
    function ext(url) { var m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(url); return m ? m[1].toLowerCase() : 'mp4'; }
    L.add = function (name, group, logo, url) {
      var ep = EPISODE.exec(name);
      if (ep || SERIES_URL.test(url)) {
        var show = (ep ? ep[1] : name).replace(/[\s._-]+$/, '').trim() || name, sid = 's' + hash(group + '|' + show.toLowerCase()), list = L.urls.s[sid];
        if (!list) {
          list = L.urls.s[sid] = [];
          var y = YEAR.exec(show);
          L.series.rows.push([sid, show, logo || '', '', '', y ? y[1] : '', cat('series', group), 0]);
        }
        var u = split(url);
        list.push([ep ? +ep[2] : 1, ep ? +ep[3] : list.length + 1, u[0], u[1]]);
        return;
      }
      var mid = 'm' + hash(group + '|' + name);
      if (L.seen[mid]) mid += '_' + (L.seen[mid]++); else L.seen[mid] = 1;
      L.urls.m[mid] = split(url);
      L.movie.rows.push([mid, name, logo || '', '', ext(url), cat('movie', group), 0]);
    };
    L.done = function () {
      delete L.urls.pmap;
      return { movie: { rows: L.movie.rows, cats: L.movie.cats }, series: { rows: L.series.rows, cats: L.series.cats }, urls: L.urls };
    };
    return L;
  }

  // Single pass line parser.  No regex per attribute; one regex over the EXTINF line.  Lines are read in
  // place, not split into an array first: on a 90 MB list that array alone was hundreds of MB.
  var ATTR = /([a-zA-Z0-9\-_]+)="([^"]*)"/g;
  /* Request options after the address, the Kodi and TiviMate way: "http://host/1.ts|User-Agent=Agent&Referer=...".
     They are not part of the address (a provider answers it with an error), so they come off; the
     User-Agent, Referer and Origin stay with the channel for the helper to send (Net.wrap's ua and hdr). */
  var OPTS = /^[A-Za-z][A-Za-z0-9-]*=/;
  function options(url) {
    var bar = url.indexOf('|');
    if (bar < 0 || !OPTS.test(url.slice(bar + 1))) return null;
    var out = { url: url.slice(0, bar).trim(), ua: '', hdr: null }, parts = url.slice(bar + 1).split('&');
    function val(v) { try { return decodeURIComponent(v).trim(); } catch (e) { return v.trim(); } }
    for (var i = 0; i < parts.length; i++) {
      var m = /^(user-agent|referr?er|origin)=(.*)$/i.exec(parts[i]);
      if (!m) continue;
      var k = m[1].toLowerCase(), v = val(m[2]);
      if (k === 'user-agent') out.ua = v;
      // Referer and Origin go with the channel too, for the helper to send (issue #78's follow-up).
      else if (v && /^https?:\/\//i.test(v)) (out.hdr || (out.hdr = {}))[k === 'origin' ? 'Origin' : 'Referer'] = v.slice(0, 500);
    }
    return out;
  }
  /* #KODIPROP and #EXTVLCOPT lines onto the channel: DASH (an .mpd address, or Kodi's manifest_type or
     mimetype), its licence (inputstream.adaptive.license_type and license_key: Widevine, PlayReady or
     ClearKey, player.js dashEngine), and VLC's http-user-agent and http-referrer. */
  var DRM = { 'com.widevine.alpha': 'widevine', widevine: 'widevine', 'com.microsoft.playready': 'playready', playready: 'playready', 'org.w3.clearkey': 'clearkey', clearkey: 'clearkey' };
  function withProps(ch, pr) {
    var mt = (pr['inputstream.adaptive.manifest_type'] || '').toLowerCase(), mime = (pr.mimetype || '').toLowerCase();
    if (mt === 'mpd' || /dash\+xml/.test(mime) || /\.mpd(\?|$)/i.test(ch.url)) ch.dash = 1;
    var lt = DRM[(pr['inputstream.adaptive.license_type'] || '').toLowerCase()], lk = pr['inputstream.adaptive.license_key'] || '';
    if (lt) ch.drm = { type: lt, key: lk.slice(0, 4000) };
    if (!ch.ua && pr['http-user-agent']) ch.ua = pr['http-user-agent'].slice(0, 300);
    var ref = pr['http-referrer'] || pr['http-referer'];
    if (ref && /^https?:\/\//i.test(ref) && !(ch.hdr && ch.hdr.Referer)) (ch.hdr || (ch.hdr = {})).Referer = ref.slice(0, 500);
  }
  function parseM3U(text, opts) {
    var lib = opts && opts.vod ? library() : null;
    var groups = [], gmap = {}, chans = [], cur = null, epgUrl = '';
    var nl0 = text.indexOf('\n'), head = nl0 < 0 ? text : text.slice(0, nl0);
    var m = head.match(/(?:url-tvg|x-tvg-url)="([^"]+)"/);
    if (m) epgUrl = m[1].split(',')[0];
    var liveOnly = !lib && count(text, '#EXTINF') > BIG, skipped = 0, props = {};
    for (var pos = 0, len = text.length; pos < len;) {
      var nl = text.indexOf('\n', pos);
      if (nl < 0) nl = len;
      var L = text.slice(pos, nl);
      pos = nl + 1;
      if (L.charCodeAt(L.length - 1) === 13) L = L.slice(0, -1);   // \r\n
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
        } else if (L.indexOf('#KODIPROP:') === 0 || L.indexOf('#EXTVLCOPT:') === 0) {
          // Kodi's and VLC's per-channel options, before or after #EXTINF: DASH and its licence (discussion
          // #79), a User-Agent or Referer.  Kept until the channel's address.
          var eq = L.indexOf('='), pk = eq > 0 ? L.slice(L.indexOf(':') + 1, eq).trim().toLowerCase() : '';
          if (pk) props[pk] = L.slice(eq + 1).trim();
        }
        continue;
      }
      if (cur) {
        var url = L.trim(), opt = options(url);
        if (opt) url = opt.url;
        if ((lib || liveOnly) && VOD.test(url)) {
          if (lib) lib.add(cur.name || cur.attrs['tvg-name'] || 'Untitled', cur.attrs['group-title'] || 'Other', cur.attrs['tvg-logo'] || '', url); else skipped++;
          cur = null; continue;
        }
        var gname = cur.attrs['group-title'] || 'Ungrouped';
        var gid = gmap[gname];
        if (!gid) { gid = 'm' + hash(gname); gmap[gname] = gid; groups.push({ id: gid, name: gname }); }
        var key = 'm' + hash((cur.attrs['tvg-id'] || '') + '|' + (cur.attrs['tvg-name'] || cur.name) + '|' + gname);
        var ch = {
          k: key, id: key, n: cur.name || cur.attrs['tvg-name'] || 'Channel', g: gid,
          logo: cur.attrs['tvg-logo'] || '', num: +cur.attrs['tvg-chno'] || 0,
          epg: cur.attrs['tvg-id'] || '', url: url,
          arch: cur.attrs['catchup'] || cur.attrs['catchup-type'] || cur.attrs['tvg-rec'] ? (+cur.attrs['catchup-days'] || +cur.attrs['tvg-rec'] || 3) : 0,
          cu: cur.attrs['catchup'] || cur.attrs['catchup-type'] || '', cus: cur.attrs['catchup-source'] || ''
        };
        if (opt && opt.ua) ch.ua = opt.ua;
        if (opt && opt.hdr) ch.hdr = opt.hdr;
        withProps(ch, props);
        props = {};
        chans.push(ch);
        cur = null;
      }
    }
    // Duplicate keys (same name+id in the same group) get a suffix so edits stay unique.
    var seen = {};
    for (var j = 0; j < chans.length; j++) {
      var c = chans[j];
      if (seen[c.k]) { c.k = c.k + '_' + (seen[c.k]++); c.id = c.k; } else seen[c.k] = 1;
    }
    var out = { groups: groups, channels: chans, epgUrl: epgUrl, vodSkipped: skipped };
    if (lib) out.vod = lib.done();
    return out;
  }

  return { hash: hash, xtream: xtream, parseM3U: parseM3U, BIG: BIG };
})();
if (typeof module !== 'undefined') module.exports = PlShape;
