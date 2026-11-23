/* Subtitle files beside a My media video (as Plex reads them): "Show.S03E03.srt", "Show.S03E03.en.srt",
   "Show.S03E03.eng.forced.srt" next to the file, a Subs or Subtitles folder beside it (with the video's own
   folder inside, as release groups do: Subs/<video name>/2_English.srt), and any subtitle file in a folder
   that holds only that one video.  Found when the video plays, not at the scan: a listing of its folder.
     lookup(source, path, cb)  cb({ subs: [{ name, lang, forced, sdh, path }] })   (Dropbox, WebDAV, Google Drive)
     get(source, path, cb)   cb({ text }) or cb({ error })                       (at most 3 MB)  */
'use strict';
var URL_ = require('url'), http = require('http'), https = require('https');
var SUB = /\.(srt|vtt|ass|ssa)$/i, VIDEO = /\.(mkv|mp4|m4v|avi|mov|m2ts|ts|webm)$/i, SUBDIR = /^(subs?|subtitles?|subtitle files)$/i;
var MAX = 3 * 1048576, MAX_SUBS = 12;
function str(v) { return v == null ? '' : String(v); }
function stem(n) { return str(n).replace(/\.[^.]+$/, ''); }
function norm(s) { return str(s).toLowerCase().replace(/[\s._-]+/g, '.'); }

/* Language and kind from what follows the video's name (".en.forced") or the file's own name ("2_English"). */
var NAMES = { english: 'en', eng: 'en', en: 'en', spanish: 'es', spa: 'es', es: 'es', esp: 'es', french: 'fr', fre: 'fr', fra: 'fr', fr: 'fr', german: 'de', ger: 'de', deu: 'de', de: 'de',
  italian: 'it', ita: 'it', it: 'it', portuguese: 'pt', por: 'pt', pt: 'pt', 'pt-br': 'pt-br', ptbr: 'pt-br', brazilian: 'pt-br', dutch: 'nl', dut: 'nl', nld: 'nl', nl: 'nl', russian: 'ru', rus: 'ru', ru: 'ru',
  polish: 'pl', pol: 'pl', pl: 'pl', swedish: 'sv', swe: 'sv', sv: 'sv', danish: 'da', dan: 'da', da: 'da', norwegian: 'no', nor: 'no', no: 'no', nob: 'no', finnish: 'fi', fin: 'fi', fi: 'fi',
  greek: 'el', gre: 'el', ell: 'el', el: 'el', turkish: 'tr', tur: 'tr', tr: 'tr', arabic: 'ar', ara: 'ar', ar: 'ar', hebrew: 'he', heb: 'he', he: 'he', hindi: 'hi', hin: 'hi', hi: 'hi',
  japanese: 'ja', jpn: 'ja', ja: 'ja', korean: 'ko', kor: 'ko', ko: 'ko', chinese: 'zh', chi: 'zh', zho: 'zh', zh: 'zh', czech: 'cs', cze: 'cs', ces: 'cs', cs: 'cs', hungarian: 'hu', hun: 'hu', hu: 'hu',
  romanian: 'ro', rum: 'ro', ron: 'ro', ro: 'ro', croatian: 'hr', hrv: 'hr', hr: 'hr', serbian: 'sr', srp: 'sr', sr: 'sr', ukrainian: 'uk', ukr: 'uk', uk: 'uk', vietnamese: 'vi', vie: 'vi', vi: 'vi',
  thai: 'th', tha: 'th', th: 'th', indonesian: 'id', ind: 'id', id: 'id', malay: 'ms', may: 'ms', msa: 'ms', bulgarian: 'bg', bul: 'bg', bg: 'bg' };
function describe(name, base) {
  var rest = norm(stem(name)), b = norm(base);
  if (b && rest.indexOf(b) === 0) rest = rest.slice(b.length);
  var words = rest.replace(/(^|\.)pt\.br(\.|$)/, '$1ptbr$2').split('.').filter(Boolean), lang = '', forced = false, sdh = false;
  words.forEach(function (w) {
    w = w.replace(/^\d+_?/, '');               // "2_English"
    if (/^forced$/.test(w)) forced = true; else if (/^(sdh|cc|hi)$/.test(w) && lang) sdh = true; else if (!lang && NAMES[w]) lang = NAMES[w];
  });
  return { lang: lang, forced: forced, sdh: sdh };
}
/* Which of a folder's subtitle files belong to the video: named after it, or the only video there. */
function pick(entries, video, inSubdir) {
  var base = stem(video), b = norm(base), videos = entries.filter(function (e) { return !e.dir && VIDEO.test(e.name); }).length;
  return entries.filter(function (e) {
    if (e.dir || !SUB.test(e.name)) return false;
    var n = norm(stem(e.name));
    return n === b || n.indexOf(b + '.') === 0 || (inSubdir ? inSubdir === 'own' || videos <= 1 : videos <= 1);
  }).map(function (e) { var d = describe(e.name, base); return { name: e.name, lang: d.lang, forced: d.forced, sdh: d.sdh, path: e.path }; });
}

/* ---------- listing a folder: [{ name, dir, path }] ---------- */
function getText(url, headers, cb, left) {
  var u = URL_.parse(url), mod = u.protocol === 'https:' ? https : http, done = false;
  var req = mod.request({ method: 'GET', hostname: u.hostname, port: u.port, path: u.path, headers: headers || {} }, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (left == null ? 3 : left) > 0) { res.resume(); return getText(URL_.resolve(url, res.headers.location), headers, cb, (left == null ? 3 : left) - 1); }
    if (res.statusCode !== 200) { res.resume(); return finish({ status: res.statusCode }); }
    var parts = [], n = 0;
    res.on('data', function (d) { n += d.length; if (n > MAX) { req.abort(); return finish({ status: 413 }); } parts.push(d); });
    res.on('end', function () { finish(null, Buffer.concat(parts)); });
  });
  function finish(e, b) { if (done) return; done = true; cb(e, b); }
  req.setTimeout(20000, function () { req.abort(); finish({ status: 0 }); });
  req.on('error', function () { finish({ status: 0 }); });
  req.end();
}
function webdavList(source, dir, cb) {
  var M = require('./media'), u; try { u = URL_.parse(str(source.address)); } catch (e) { return cb([]); }
  if (!u || !u.hostname) return cb([]);
  var origin = u.protocol + '//' + u.host, body = '<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
  var mod = u.protocol === 'https:' ? https : http, d = dir.replace(/\/?$/, '/');
  var req = mod.request({ method: 'PROPFIND', hostname: u.hostname, port: u.port, path: d.split('/').map(function (p) { try { return encodeURIComponent(decodeURIComponent(p)); } catch (e) { return encodeURIComponent(p); } }).join('/'),
    headers: { Authorization: M.basicAuth(source), Depth: '1', 'Content-Type': 'application/xml; charset="utf-8"', 'Content-Length': Buffer.byteLength(body) } }, function (res) {
    var raw = ''; res.setEncoding('utf8'); res.on('data', function (x) { if (raw.length < 4 * 1048576) raw += x; });
    res.on('end', function () {
      if (res.statusCode !== 207 && res.statusCode !== 200) return cb([]);
      cb(M.parsePropfind(raw).map(function (it) {
        var p = URL_.parse(URL_.resolve(origin + d, it.href)).pathname || '', name = it.name || decodeURIComponent(p.replace(/\/+$/, '').split('/').pop() || '');
        return { name: name, dir: it.dir, path: decodeURIComponent(p).replace(/\/+$/, '') };
      }).filter(function (e) { return e.path.replace(/\/+$/, '') !== decodeURIComponent(d).replace(/\/+$/, ''); }));
    });
  });
  req.setTimeout(20000, function () { req.abort(); }); req.on('error', function () { cb([]); }); req.end(body);
}
function dropboxList(source, dir, cb) {
  require('./dropbox').listFiles(source, dir, function (e, list) { cb(e ? [] : list.map(function (x) { return { name: x.name, dir: x.tag === 'folder', path: x.path_display }; })); });
}
function smbList(source, dir, cb) {
  require('./smb').list(source, dir, function (e, list) { cb(e ? [] : list); });
}
// A subtitle file on a share: its first MAX bytes, read like a movie (smb.js reader).
function smbText(source, path, cb) {
  var r = require('./smb').reader(source, path);
  r.size(function (e, st) {
    if (e || !st || st.dir) return cb({ status: 404 });
    if (!st.size) return cb(null, Buffer.concat([]));
    r.open(0, Math.min(st.size, MAX) - 1, function (e2, stream) {
      if (e2) return cb({ status: 0 });
      var parts = [];
      stream.on('data', function (d) { parts.push(d); });
      stream.on('error', function () { cb({ status: 0 }); });
      stream.on('end', function () { cb(null, Buffer.concat(parts)); });
    });
  });
}
function gdriveList(source, folderId, cb) {
  var G = require('./gdrive');
  G.get(source.key, 'files', { q: "'" + folderId + "' in parents and trashed=false", fields: 'files(id,name,mimeType)', pageSize: 300, supportsAllDrives: true, includeItemsFromAllDrives: true }, function (e, j) {
    cb(e ? [] : (j.files || []).map(function (f) { return { name: str(f.name), dir: f.mimeType === 'application/vnd.google-apps.folder', path: 'gd:' + f.id + '/' + str(f.name), id: f.id }; }));
  });
}

/* ---------- find and get ---------- */
function lookup(source, path, cb) {
  source = source || {}; path = str(path);
  var video = path.split('/').pop(), out = [], looked = 0, other = [];
  function more(entries, inSub) {
    looked += entries.length;
    entries.forEach(function (e) { if (!e.dir && SUB.test(e.name) && other.length < 5) other.push(e.name.slice(-60)); });
    pick(entries, video, inSub).forEach(function (s) { if (out.length < MAX_SUBS && !out.some(function (o) { return o.path === s.path; })) out.push(s); }); }
  // The folder, then its Subs folder, then the video's own folder in that.
  function walk(list, entries, done) {
    more(entries, '');
    var subdir = entries.filter(function (e) { return e.dir && SUBDIR.test(e.name); })[0];
    if (!subdir) return done();
    list(subdir, function (inner) {
      more(inner, 'subs');
      var own = inner.filter(function (e) { return e.dir && norm(e.name) === norm(stem(video)); })[0];
      if (!own) return done();
      list(own, function (deeper) { more(deeper, 'own'); done(); });
    });
  }
  // For the log: how many entries were looked at, and the subtitle files there (whether they matched or not).
  var finish = function () { cb({ subs: out, looked: looked, seen: other }); };
  if (source.type === 'dropbox') {
    var dir = path.replace(/\/[^\/]*$/, '');
    return dropboxList(source, dir, function (entries) { walk(function (e, then) { dropboxList(source, e.path, then); }, entries, finish); });
  }
  if (source.type === 'gdrive') {
    var G = require('./gdrive'), id = G.idOf(path);
    if (!id) return cb({ subs: [] });
    video = path.replace(/^gd:[^\/]+\/?/, '').split('/').pop();
    return G.get(source.key, 'files/' + encodeURIComponent(id), { fields: 'parents,name', supportsAllDrives: true }, function (e, j) {
      if (e || !j.parents || !j.parents[0]) return cb({ subs: [] });
      video = str(j.name) || video;
      gdriveList(source, j.parents[0], function (entries) { walk(function (x, then) { gdriveList(source, x.id, then); }, entries, finish); });
    });
  }
  if (source.type === 'smb') {
    return smbList(source, path.replace(/\/[^\/]*$/, ''), function (entries) { walk(function (x, then) { smbList(source, x.path, then); }, entries, finish); });
  }
  if (source.type === 'webdav' || source.address) {
    return webdavList(source, path.replace(/\/[^\/]*$/, ''), function (entries) { walk(function (x, then) { webdavList(source, x.path, then); }, entries, finish); });
  }
  cb({ subs: [], looked: 0, seen: [] });   // DLNA: the server's own come with the file (fromServer)
}
/* A DLNA server's own subtitles for a video (media.js parseBrowse: a res of their own, or Samsung's caption tag),
   kept with the file at the scan: [{ url, lang }] -> the shape lookup() gives. */
function fromServer(list) {
  return (Array.isArray(list) ? list : []).filter(function (x) { return x && /^https?:\/\//i.test(str(x.url)); }).slice(0, 6).map(function (x) {
    var name = decodeURIComponent(str(x.url).split('?')[0].split('/').pop() || '') || 'Subtitles', l = str(x.lang).toLowerCase().replace(/[^a-z-]/g, '');
    var d = describe(name, ''), lang = NAMES[l] || NAMES[l.split('-')[0]] || d.lang;
    return { name: name.slice(0, 120), lang: lang, forced: d.forced, sdh: d.sdh, path: str(x.url) };
  }).map(function (x, i, all) { if (!x.lang) x.name = 'Subtitles' + (all.length > 1 ? ' ' + (i + 1) : '') + '.srt'; return x; });   // "123.srt" says nothing
}
function sameHost(a, b) { try { return URL_.parse(a).hostname === URL_.parse(b).hostname; } catch (e) { return false; } }
function get(source, path, lang, cb) {
  source = source || {}; path = str(path);
  var decode = function (e, buf) { if (e) return cb({ error: 'HTTP ' + (e.status || 'error') }); cb({ text: require('./subtitles')._test.decode(buf, lang) }); };
  // DLNA: the server's own address for it (any name), only from the server the source is.
  if (source.type === 'dlna') { if (!/^https?:\/\//i.test(path) || !sameHost(path, source.control)) return cb({ error: 'address' }); return getText(path, {}, decode); }
  if (!SUB.test(path.replace(/\?.*$/, ''))) return cb({ error: 'not a subtitle file' });
  if (source.type === 'dropbox') return require('./dropbox').tempLink(source, path, function (e, url) { if (e) return cb({ error: e.message }); getText(url, {}, decode); });
  if (source.type === 'smb') return smbText(source, path, decode);
  if (source.type === 'gdrive') {
    var G = require('./gdrive'), id = G.idOf(path);
    if (!id) return cb({ error: 'address' });
    return G.authorizer(source.key)(function (e, auth) { if (e) return cb({ error: e.message }); getText(G.fileUrl(id), { Authorization: auth }, decode); });
  }
  var u; try { u = URL_.parse(str(source.address)); } catch (e) { return cb({ error: 'address' }); }
  if (!u || !u.hostname || path.charAt(0) !== '/') return cb({ error: 'address' });
  getText(u.protocol + '//' + u.host + path.split('/').map(function (p) { return encodeURIComponent(p); }).join('/'), { Authorization: require('./media').basicAuth(source) }, decode);
}
/* A library's folders and subtitle files, for Load a subtitle file in the player (subs.js): path empty starts at the
   library's own folder.  cb({ entries: [{ name, dir, path }] }), folders first.  DLNA has no folders to look in. */
function browse(source, path, cb) {
  source = source || {}; path = str(path);
  function done(list) {
    var out = (list || []).filter(function (e) { return e && e.name && e.name.charAt(0) !== '.' && (e.dir || SUB.test(e.name)); })
      .map(function (e) { return { name: str(e.name), dir: !!e.dir, path: e.id && source.type === 'gdrive' && e.dir ? 'gd:' + e.id + '/' + str(e.name) : str(e.path) }; });
    out.sort(function (a, b) { return (b.dir - a.dir) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
    cb({ entries: out.slice(0, 500) });
  }
  if (source.type === 'smb') return smbList(source, path || str(source.folder) || '/', done);
  if (source.type === 'dropbox') return dropboxList(source, path || require('./dropbox').folderPath(source.root), done);
  if (source.type === 'gdrive') { var id = path ? require('./gdrive').idOf(path) : str(source.root); return id ? gdriveList(source, id, done) : done([]); }
  if (source.type === 'webdav' || source.address) {
    var root = ''; try { root = decodeURIComponent(URL_.parse(str(source.address)).pathname || '/'); } catch (e) { root = '/'; }
    return webdavList(source, path || root, done);
  }
  done([]);
}
module.exports = { lookup: lookup, get: get, browse: browse, fromServer: fromServer, _test: { pick: pick, describe: describe } };
