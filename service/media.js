/* My media, helper side.  Finds and reads the viewer's own movie servers: DLNA (like a Fritz!Box, no
   login) and WebDAV (like premiumize, with a login).  The app asks over /media/ routes, which need the
   helper's secret because a login goes through them (see proxy.js).

   Three things stay separate on purpose: a movie's id (from its stable path), its container, and the
   address it plays from.  At every play, WebDAV gives either a fresh signed link or
   a temporary localhost stream whose login stays in the helper (media-stream.js).

   Logs name hosts only.  A login goes only to the host it was entered for, never after a redirect to
   another one, and certificates are always checked for WebDAV.
   TV shows (contentMode automatic or shows) go into the catalogue (media-catalog.js).  A movies-only
   scan never needs it, nor a checkpoint: if either cannot be read the scan still answers.  A show
   scan for a source not saved yet waits for /media/library/adopt (at most two, five minutes) and is
   only dropped once imported, so a failed adopt can be retried.
   Plain ES5 for Node 0.12 on webOS 4 (see compat.js). */
'use strict';
var Classifier = require('./media-classify');
require('./compat');
var dgram = require('dgram');
var http = require('http');
var https = require('https');
var URL_ = require('url');
var CA = require('./media-ca');

var REQUEST_MS = 8000, SCAN_MS = 120000, PAGE = 200, MAX_DEPTH = 12, MAX_FOLDERS = 3000, BODY_MAX = 16 * 1024 * 1024;
var VIDEO = /\.(mkv|mp4|m4v|avi|mov|m2ts|ts|webm)$/i;
var SAMPLE = /(^|[\s._-])sample([\s._-]|\.[^.]+$|$)/i;
var JUNK = /^(\$recycle\.bin|system volume information|fritz|mediabox|lost\+found|recycler)$/i;
// What a media server adds at its top, which holds no movies of the viewer's own.
var SERVER_EXTRAS = /^(music|musik|audio|images|bilder|pictures|photos|fotos|internet radio|internetradio|podcasts|file index|dateiindex)$/i;
var QUALITY = /(^|[\s(\[-])(2160p|1080p|720p|576p|480p|4k|uhd|blu-?ray|brrip|bdrip|bdremux|remux|web-?dl|webrip|dvdrip|hdtv|x264|x265|h264|h265|hevc|avc)(?=$|[\s)\]-])/i;
var TOKENS = [['2160p', /2160p|\b4k\b|\buhd\b/i], ['1080p', /1080p/i], ['720p', /720p/i], ['HEVC', /hevc|x265|h\.?265/i], ['H.264', /x264|h\.?264|\bavc\b/i],
  ['HDR', /\bhdr(10)?\b/i], ['Dolby Vision', /\bdv\b|dolby.?vision/i], ['Atmos', /atmos/i], ['TrueHD', /truehd/i], ['DTS', /\bdts\b/i], ['Dolby Digital', /\bddp?[\s.]?5[\s.]?1\b|\bac3\b/i], ['Remux', /remux/i]];

function str(v) { return v == null ? '' : String(v); }
function unescapeXml(s) {
  return str(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#0*39;/g, "'").replace(/&#0*34;/g, '"').replace(/&amp;/g, '&');
}
function escapeXml(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function tag(text, name) {
  var m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i').exec(text);
  return m ? unescapeXml(m[1]).trim() : '';
}
function attr(text, name) {
  var m = new RegExp('\\b' + name + '="([^"]*)"', 'i').exec(text);
  return m ? unescapeXml(m[1]) : '';
}
function decodePart(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
function lastPart(p) { var a = str(p).split('?')[0].replace(/\/+$/, '').split('/'); return decodePart(a[a.length - 1] || ''); }

/* ---------- names ---------- */
// Folders named Title (Year) are what the viewer chose, so they win.  Otherwise the file's name, with
// its scene words cut off.  The last year before those words counts: Blade Runner 2049 (2017) is 2017.
function titleOf(folder, file) {
  var f = /^\s*(.+?)\s*\((\d{4})\)\s*$/.exec(str(folder));
  if (f) return { title: f[1], year: f[2] };
  var s = str(file).replace(/\.[A-Za-z0-9]{2,4}$/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  var q = QUALITY.exec(s);
  if (q) s = s.slice(0, q.index);
  var re = /(^|[\s(\[-])((?:19|20)\d{2})(?=$|[\s)\]-])/g, m, year = '', at = -1;
  while ((m = re.exec(s))) { if (m.index > 0 || m[1]) { if (m.index > 0) { year = m[2]; at = m.index; } } }
  var title = (at >= 0 ? s.slice(0, at) : s).replace(/[\s(\[-]+$/, '').trim();
  return { title: title || str(file), year: year };
}
function isJunk(name) { name = str(name); return name.charAt(0) === '.' || JUNK.test(name); }
function isMovieFile(name) { return VIDEO.test(str(name)) && !SAMPLE.test(str(name)); }

/* ---------- movies only ----------
   My media is for movies for now, so TV and a movie's extras are left out, and counted so the scan can
   say so ("Left out 40 TV episodes and 6 extras").  The names are the ones Plex, Jellyfin and Kodi
   use, and what downloads are called. */
// Folders not looked into: a season of a show, a movie's extras.
var TV_FOLDER = /^(season|series|staffel|saison|temporada|stagione|seizoen)[\s._-]*\d{1,3}$|^specials$|(^|[\s._-])s\d{1,2}([\s._-]|$)|(^|[\s._-])(complete[\s._-])?(season|series)[\s._-]*\d{1,2}([\s._-]|$)/i;
var EXTRAS_FOLDER = /^(extras?|featurettes?|behind[\s._-]the[\s._-]scenes|deleted[\s._-]scenes|interviews?|scenes|shorts?|trailers?|bonus([\s._-]features)?|making[\s._-]of|other|samples?)$/i;
// Files: an episode (S01E02, 1x02, Episode 3), or an extra (Plex's "-trailer" names, or trailer/teaser/featurette in the name).
var EPISODE = /(^|[\s._\[(-])s\d{1,2}[\s._-]?e\d{1,3}|(^|[\s._\[(-])\d{1,2}x\d{2,3}([\s._\])-]|$)|(^|[\s._-])(episode|ep)[\s._-]?\d{1,3}([\s._-]|$)/i;
var EXTRA_FILE = /-(trailer|teaser|featurette|behindthescenes|deleted|interview|scene|short|other|extra)\d*\.[a-z0-9]{2,4}$|(^|[\s._-])(trailer|teaser|featurette)([\s._-]|\.[a-z0-9]{2,4}$)/i;
var SMALL = 100 * 1024 * 1024;          // a known size under 100 MB is a clip, not a movie
function skipFolder(name, skipped) {
  if (TV_FOLDER.test(str(name))) { skipped.tvFolders++; return true; }
  if (EXTRAS_FOLDER.test(str(name))) { skipped.extras++; return true; }
  return false;
}
/* One folder's video files ([{ file, size }]): the movies among them.  In a movie's own folder ("Frozen
   (2013)", "Frozen.2013.1080p.BluRay", a few videos), a much smaller video (under a quarter of the
   biggest) is one of its extras, whatever it is called.  Not in a folder of many movies, where a small
   old film can sit next to a big 4K one. */
function moviesOf(files, skipped, folder) {
  var ownFolder = /(^|[^0-9])(19|20)\d{2}([^0-9]|$)/.test(str(folder)) && files.length <= 5;
  var keep = [], big = 0;
  files.forEach(function (f) {
    if (EPISODE.test(f.file)) { skipped.episodes++; return; }
    if (EXTRA_FILE.test(f.file)) { skipped.extras++; return; }
    if (f.size && f.size < SMALL) { skipped.extras++; return; }
    keep.push(f); if (f.size > big) big = f.size;
  });
  return keep.filter(function (f) {
    if (ownFolder && keep.length > 1 && f.size && big && f.size < big / 4) { skipped.extras++; return false; }
    return true;
  });
}
function newSkipped() { return { episodes: 0, tvFolders: 0, extras: 0 }; }
function tokens(file) {
  var out = [], name = str(file).replace(/_/g, ' ');
  TOKENS.forEach(function (t) { if (t[1].test(name)) out.push(t[0]); });
  return out;
}
function extOf(file, proto) {
  var m = /\.([A-Za-z0-9]{2,4})$/.exec(str(file));
  if (m) return m[1].toLowerCase();
  return /matroska/i.test(proto) ? 'mkv' : /mp4/i.test(proto) ? 'mp4' : '';
}

/* ---------- small HTTP client ---------- */
function errorKind(e) {
  var code = (e && e.code) || '';
  return /CERT|UNABLE_TO_GET_ISSUER|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO/i.test(code) || /certificate/i.test((e && e.message) || '') ? 'cert' : 'unreachable';
}
var MESSAGES = {
  login: 'The server did not accept that login.',
  cert: 'TiviBro could not check this server\'s security certificate.',
  unreachable: 'The server did not answer.',
  address: 'That address does not work.  It has to start with http:// or https://.'
};
function failure(kind) { return { error: kind, message: MESSAGES[kind] }; }

// opts: url, method, headers, body, secure (send the pinned certificates); cb(err, status, headers, bodyText)
function request(opts, cb) {
  var u; try { u = URL_.parse(opts.url); } catch (e) { return cb(e); }
  var isTls = u.protocol === 'https:', done = false;
  function finish(e, s, h, b) {
    if (done) return;
    done = true;
    // Old TVs' Node predates today's Let's Encrypt roots: a certificate it can't check is tried once more
    // against the chain in media-ca.js, for any server (still checked, never skipped).
    if (e && isTls && opts.secure && !opts.withCa && errorKind(e) === 'cert') return request(Object.assign({}, opts, { withCa: true }), cb);
    cb(e, s, h, b);
  }
  // An address typed with "é" or a space: url.parse leaves them, and Node refuses (or garbles) them in a request.
  var o = { hostname: u.hostname, port: u.port || (isTls ? 443 : 80), path: str(u.path || '/').replace(/[^\x21-\x7e]+/g, function (run) { return encodeURIComponent(run); }), method: opts.method || 'GET', headers: opts.headers || {}, agent: false };
  if (isTls && opts.secure && opts.withCa) o.ca = CA;
  var req = (isTls ? https : http).request(o, function (res) {
    if (opts.headOnly) { res.resume(); finish(null, res.statusCode, res.headers, ''); try { req.abort(); } catch (e) {} return; }
    var chunks = [], len = 0;
    res.on('data', function (d) { len += d.length; if (len > BODY_MAX) { finish(new Error('response too large')); req.abort(); } else chunks.push(d); });
    res.on('end', function () { finish(null, res.statusCode, res.headers, Buffer.concat(chunks).toString('utf8')); });
    res.on('error', function (e) { finish(e); });
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(REQUEST_MS, function () { var e = new Error('timed out'); finish(e); try { req.abort(); } catch (x) {} });
  if (opts.body) req.write(opts.body);
  req.end();
}

/* ---------- DLNA ---------- */
function browseBody(id, start) {
  return '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
    '<u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>' + escapeXml(id) + '</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter>' +
    '<StartingIndex>' + start + '</StartingIndex><RequestedCount>' + PAGE + '</RequestedCount><SortCriteria></SortCriteria></u:Browse></s:Body></s:Envelope>';
}
function parseBrowse(raw) {
  var r = /<Result>([\s\S]*?)<\/Result>/i.exec(raw), didl = r ? unescapeXml(r[1]) : '', items = [];
  var re = /<(container|item)\b([^>]*)>([\s\S]*?)<\/\1>/g, m;
  while ((m = re.exec(didl))) {
    var it = { dir: m[1] === 'container', id: attr(m[2], 'id'), title: tag(m[3], 'dc:title') };
    if (!it.dir) {
      var seriesTitle = tag(m[3], 'upnp:seriesTitle'), episodeNumber = tag(m[3], 'upnp:episodeNumber');
      if (seriesTitle && /^[1-9][0-9]*$/.test(episodeNumber)) it.server = {validated:true,showTitle:seriesTitle,number:+episodeNumber};
      var rre = /<res\b([^>]*)>([\s\S]*?)<\/res>/g, rm;
      while ((rm = rre.exec(m[3]))) {
        var proto = attr(rm[1], 'protocolInfo');
        if (/:video\//i.test(proto) && !it.url) { it.url = unescapeXml(rm[2]).trim(); it.proto = proto; it.size = +attr(rm[1], 'size') || 0; }
      }
    }
    items.push(it);
  }
  return { items: items, total: +tag(raw, 'TotalMatches') || 0, returned: +tag(raw, 'NumberReturned') || 0, fault: /<Fault>/i.test(raw) };
}
function browseAll(control, id, cb, options) {
  options = options || {};
  var items = [], initial = options.start || 0;
  (function page(start) {
    if((options.paused&&options.paused())||(options.deadline && Date.now()>options.deadline)){var budget=new Error('Scan slice finished.');budget.budget=true;budget.items=items;budget.nextStart=start;return cb(budget);}
    request({ url: control, method: 'POST', body: browseBody(id, start), headers: {
      'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"', 'Content-Length': Buffer.byteLength(browseBody(id, start))
    } }, function (e, status, h, body) {
      if (e) return cb(e);
      if (status !== 200) return cb(new Error('HTTP ' + status));
      var p = parseBrowse(body);
      if (p.fault) return cb(new Error('the server refused'));
      if (items.length && start && p.items.length && p.items[0].id === items[0].id) return cb(new Error('the server repeated a page'));
      items = items.concat(p.items);
      if (p.items.length && start + p.items.length < p.total) return page(start + p.items.length);
      cb(null, items);
    });
  })(initial);
}
function discovery(source) { return source.contentMode === 'automatic' || source.contentMode === 'shows'; }
function observed(source, file, ancestors, extra) {
  var r = Classifier.classify({ basename: file, ancestors: ancestors, server: extra && extra.server }, { order: source.defaultOrder, compact:true });
  if(r.kind==='movie' && ancestors.some(function(name){return EXTRAS_FOLDER.test(String(name));})){r.kind='extra';r.evidence.push({origin:'folder',fields:{kind:'extra'}});}
  if(r.kind==='movie' && extra && extra.size>0 && extra.size<SMALL){r.kind='unclassified';r.review.push('uncertainSmallVideo');}
  var out = extra || {};
  out.file = file; out.kind = r.kind; out.classification = r; out.ancestors = ancestors;
  out.title = r.title;
  return out;
}
// Two server entries for one file path: both need review, once (a resumed scan sees them again).
function flagCollision(entry) { var review = entry.classification.review; if (review.indexOf('identityCollision') < 0) review.push('identityCollision'); }
function safeMovieFolder(folder, files) {
  // A collection's year is not evidence that all its videos are the same movie.
  if (files.length !== 1) return '';
  var stem = str(files[0].file).replace(/\.[a-z0-9]+$/i, '');
  return /^(video|movie|film|main|feature|x)$/i.test(stem) || /^.+\(\d{4}\)\s*$/.test(folder) ? folder : '';
}
function scanDlna(source, cb) {
  var control = str(source.control);
  if (!/^https?:\/\//i.test(control)) return cb(failure('address'));
  var saved = source._continuation || {};
  var byPath = saved.byPath || {}, errors = saved.errors || [], partial = !!saved.partial, folders = 0, paused = false, deadline = Date.now() + SCAN_MS, skipped = newSkipped();
  var queue = saved.queue || [{ id: '0', name: '', depth: 0, ancestors: [] }], visited = saved.visited || {}, discovered = saved.discovered || {}, pathOwners = saved.pathOwners || {};
  function fileOf(it) {
    var u = URL_.parse(it.url), file = lastPart(u.pathname);
    if (!VIDEO.test(file)) file = it.title + (/\.[A-Za-z0-9]{2,4}$/.test(it.title) ? '' : '.' + extOf('', it.proto));
    return file;
  }
  function add(it, folderName, ancestors) {
    if (!it.url) return;
    var u = URL_.parse(it.url), file = fileOf(it);
    if (!(discovery(source) ? VIDEO.test(file) : isMovieFile(file))) return;
    var key = u.pathname + (discovery(source) ? u.search || '' : ''), named = /\(\d{4}\)\s*$/.test(folderName), was = byPath[key];
    if (was && (was.named || !named) && !discovery(source)) return;
    if (discovery(source)) {
      var entry = observed(source, file, ancestors, { id: 'd:' + u.pathname, size: it.size || 0, ext: extOf(file, it.proto), info: tokens(file), url: it.url, server: it.server });
      var prior=discovered[key];
      if(prior && prior.classification.review.length <= entry.classification.review.length && prior.ancestors.length >= entry.ancestors.length) entry=prior;
      var owner=pathOwners[u.pathname];
      if(owner && owner!==key){entry.id='d:'+key;flagCollision(entry);if(discovered[owner])flagCollision(discovered[owner]);}
      else pathOwners[u.pathname]=key;
      discovered[key] = entry;
      if (entry.kind !== 'movie' || source.contentMode === 'shows') return;
    }
    var t = titleOf(folderName, file);
    byPath[key] = { named: named, movie: { id: 'd:' + key, title: t.title, year: t.year, file: file, size: it.size || 0, ext: extOf(file, it.proto), info: tokens(file), url: it.url } };
  }
  function done() {
    var movies = Object.keys(byPath).map(function (k) { return byPath[k].movie; });
    var result={ movies: movies, files: discovery(source) ? Object.keys(discovered).map(function (k) { return discovered[k]; }) : undefined, partial: partial, errors: errors, skipped: skipped };
    if(paused)result._continuation={queue:queue,visited:visited,byPath:byPath,discovered:discovered,pathOwners:pathOwners,errors:errors.filter(function(e){return !/^stopped early/.test(e);}),partial:errors.some(function(e){return !/^stopped early/.test(e);})};
    cb(result);
  }
  (function next() {
    var c = queue.shift();
    if (!c) return done();
    if ((source._control&&source._control.paused) || Date.now() > deadline || folders >= (source.scanFolderBudget > 0 && source.scanFolderBudget <= MAX_FOLDERS ? source.scanFolderBudget : MAX_FOLDERS)) { queue.unshift(c); paused=true; partial = true; errors.push('stopped early, the server is very large'); return done(); }
    if (visited['o:'+c.id]) return next();
    visited['o:'+c.id] = true;
    folders++;
    browseAll(control, c.id, function (e, items) {
      var pageBudget=e&&e.budget;
      if(pageBudget){items=e.items;c.pageStart=e.nextStart;delete visited['o:'+c.id];}
      if (e && !pageBudget) {
        if (c.depth === 0) return cb(failure(errorKind(e)));
        partial = true; errors.push(c.name + ': ' + e.message);
        return next();
      }
      // A server's own TV views ("Series", "TV Shows") are left alone like its music.
      var vids = items.filter(function (it) { return !it.dir && it.url && (discovery(source) ? VIDEO.test(fileOf(it)) : isMovieFile(fileOf(it))); });
      var candidates = vids.map(function (it) { return { file: fileOf(it), size: it.size || 0, it: it }; });
      (discovery(source) ? candidates : moviesOf(candidates, skipped, c.name)).forEach(function (f) { add(f.it, discovery(source) ? safeMovieFolder(c.name, candidates) : c.name, c.ancestors); });
      items.forEach(function (it) {
        if (!it.dir) return;
        if (isJunk(it.title) || (c.depth < 2 && SERVER_EXTRAS.test(it.title)) || (!discovery(source) && ((c.depth < 2 && /^(tv|tv shows|series|serien|séries)$/i.test(it.title)) || skipFolder(it.title, skipped)))) return;
        if (c.depth + 1 > (source.maxDepth || MAX_DEPTH)) { partial = true; errors.push('depth limit reached'); return; }
        queue.push({ id: it.id, name: it.title, depth: c.depth + 1, ancestors: c.ancestors.concat([it.title]) });
      });
      if(pageBudget){queue.unshift(c);paused=true;partial=true;return done();}
      next();
    },{deadline:deadline,start:c.pageStart||0,paused:function(){return !!(source._control&&source._control.paused);}});
  })();
}

/* ---------- WebDAV ---------- */
var PROPFIND = '<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
function basic(source) { return 'Basic ' + Buffer.from(str(source.user) + ':' + str(source.pass)).toString('base64'); }
function parsePropfind(raw) {
  var xml = str(raw).replace(/<(\/?)[A-Za-z0-9_-]+:/g, '<$1'), out = [], re = /<response\b[^>]*>([\s\S]*?)<\/response>/gi, m;
  while ((m = re.exec(xml))) {
    out.push({ href: tag(m[1], 'href'), name: tag(m[1], 'displayname'), dir: /<collection\s*\/?>/i.test(m[1]), size: +tag(m[1], 'getcontentlength') || 0, etag:tag(m[1],'getetag').slice(0,512),modified:tag(m[1],'getlastmodified').slice(0,128) });
  }
  return out;
}
/* Same server: protocol, host name and port, with the default port filled in (https://host:443/
   is https://host/).  Paths compare decoded, since servers encode "(", "@" or "é" differently from
   url.parse (Nextcloud sends %28, %40, %C3%A9). */
function originKey(u) {
  var protocol = str(u && u.protocol).toLowerCase(), port = str(u && u.port) || (protocol === 'https:' ? '443' : protocol === 'http:' ? '80' : '');
  return protocol + '//' + str(u && u.hostname).toLowerCase() + ':' + port;
}
function samePath(p) { return decodePart(str(p)).replace(/\/+$/, ''); }
function webdavBase(source) {
  var u; try { u = URL_.parse(str(source && source.address)); } catch (e) { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  return { origin: u.protocol + '//' + u.host, key: originKey(u), path: u.pathname || '/' };
}
function scanWebdav(source, cb) {
  var base = webdavBase(source);
  if (!base) return cb(failure('address'));
  var saved = source._continuation || {};
  var movies = saved.movies || [], errors = saved.errors || [], partial = !!saved.partial, folders = 0, paused = false, deadline = Date.now() + SCAN_MS, stop = null, skipped = newSkipped();
  var queue = saved.queue || [{ path: base.path, name: '', depth: 0, ancestors: [] }], visited = saved.visited || {}, discovered = saved.discovered || [];
  function done() { if (stop) return cb(failure(stop)); var result={ movies: movies, files: discovery(source) ? discovered : undefined, partial: partial, errors: errors, skipped: skipped };if(paused)result._continuation={queue:queue,visited:visited,movies:movies,discovered:discovered,errors:errors.filter(function(e){return !/^stopped early/.test(e);}),partial:errors.some(function(e){return !/^stopped early/.test(e);})};cb(result); }
  (function next() {
    var c = queue.shift();
    if (!c || stop) return done();
    if ((source._control&&source._control.paused) || Date.now() > deadline || folders >= (source.scanFolderBudget > 0 && source.scanFolderBudget <= MAX_FOLDERS ? source.scanFolderBudget : MAX_FOLDERS)) { queue.unshift(c);paused=true;partial = true; errors.push('stopped early, the library is very large'); return done(); }
    if (visited[samePath(c.path)]) return next();
    visited[samePath(c.path)] = true;
    folders++;
    request({ url: base.origin + c.path, method: 'PROPFIND', secure: true, body: PROPFIND, headers: {
      Authorization: basic(source), Depth: '1', 'Content-Type': 'application/xml; charset="utf-8"', 'Content-Length': Buffer.byteLength(PROPFIND)
    } }, function (e, status, h, body) {
      if (e) {
        if (c.depth === 0) { stop = errorKind(e); return done(); }
        partial = true; errors.push(c.name + ': ' + e.message);
        return next();
      }
      if (status === 401 || status === 403) { stop = 'login'; return done(); }
      if (status !== 207) {
        if (c.depth === 0) { stop = 'unreachable'; return done(); }
        partial = true; errors.push(c.name + ': HTTP ' + status);
        return next();
      }
      var self = samePath(c.path), root = samePath(base.path) + '/', files = [];
      parsePropfind(body).forEach(function (it) {
        var target = URL_.parse(URL_.resolve(base.origin + c.path,it.href));
        if (originKey(target) !== base.key) { partial = true; return; }
        var p = target.pathname || it.href, plain = samePath(p);
        if (plain === self) return;
        if ((plain + '/').indexOf(root) !== 0 || /(?:^|\/)(?:\.\.|%2e%2e)(?:\/|$)/i.test(p) || /(?:^|\/)\.\.(?:\/|$)/.test(plain)) { partial = true; return; }
        var name = it.name || lastPart(p);
        if (it.dir) {
          if (c.depth + 1 > (source.maxDepth || MAX_DEPTH)) { partial = true; errors.push('depth limit reached'); return; }
          if (!isJunk(name) && (discovery(source) || !skipFolder(name, skipped))) queue.push({ path: p, name: name, depth: c.depth + 1, ancestors: c.ancestors.concat([name]) });
          return;
        }
        if (discovery(source) ? VIDEO.test(name) : isMovieFile(name)) files.push({ file: name, size: it.size || 0, path: p,etag:it.etag,modified:it.modified });
      });
      (discovery(source) ? files : moviesOf(files, skipped, c.name)).forEach(function (f) {
        if (discovery(source)) {
          var entry = observed(source, f.file, c.ancestors, { id: 'w:' + f.path, size: f.size, ext: extOf(f.file), info: tokens(f.file), path: f.path,etag:f.etag,modified:f.modified });
          discovered.push(entry);
          if (entry.kind !== 'movie' || source.contentMode === 'shows') return;
        }
        var t = titleOf(discovery(source) ? safeMovieFolder(c.name, files) : c.name, f.file);
        movies.push({ id: 'w:' + f.path, title: t.title, year: t.year, file: f.file, size: f.size, ext: extOf(f.file), info: tokens(f.file), path: f.path });
      });
      next();
    });
  })();
}
// Signed redirects stay direct.  Servers serving the authenticated file themselves
// get a temporary localhost stream, shared by the player and subtitle Range reads.
function resolve(source, path, cb) {
  var base = webdavBase(source);
  if (!base || str(path).charAt(0) !== '/') return cb(failure('address'));
  var origin = base.origin;
  (function hop(url, left) {
    request({ url: url, secure: true, headOnly: true, headers: { Authorization: basic(source), Range: 'bytes=0-0' } }, function (e, status, h) {
      if (e) return cb(failure(errorKind(e)));
      if (status === 401 || status === 403) return cb(failure('login'));
      if (status >= 300 && status < 400 && h.location) {
        var to = URL_.resolve(url, h.location), tu = URL_.parse(to);
        if (tu.protocol !== 'http:' && tu.protocol !== 'https:') return cb(failure('address'));
        if (originKey(tu) !== base.key) { hideLinksFrom(tu.host); return cb({ url: to }); }
        if (left > 0) return hop(to, left - 1);
      }
      if (status === 200 || status === 206) return cb({ url: require('./media-stream').create(url, basic(source), extOf(URL_.parse(url).pathname) || extOf(path)) });
      cb(failure('unreachable'));
    });
  })(origin + path, 3);
}

function scan(source, cb) {
  var type = source && source.type;
  if (type === 'dlna') return scanDlna(source, cb);
  if (type === 'webdav') return scanWebdav(source, cb);
  cb(failure('address'));
}

/* ---------- finding servers ---------- */
function parseDevice(xml, location) {
  var base = tag(xml, 'URLBase');
  if (!base) { var lu = URL_.parse(location); base = lu.protocol + '//' + lu.host; }
  var services = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
  for (var i = 0; i < services.length; i++) {
    if (tag(services[i], 'serviceType').indexOf('ContentDirectory') < 0) continue;
    var ctl = tag(services[i], 'controlURL');
    if (ctl) return { name: tag(xml, 'friendlyName') || URL_.parse(location).hostname, control: URL_.resolve(base, ctl) };
  }
  return null;
}
function discover(cb, ms) {
  var found = {}, sock, closed = false;
  function finish() {
    if (closed) return;
    closed = true;
    try { sock.close(); } catch (e) {}
    var locations = Object.keys(found), servers = [], seen = {};
    (function next() {
      var loc = locations.shift();
      if (!loc) return cb({ servers: servers });
      request({ url: loc }, function (e, status, h, body) {
        var d = !e && status === 200 ? parseDevice(body, loc) : null;
        if (d && !seen[d.control]) { seen[d.control] = 1; servers.push(d); }
        next();
      });
    })();
  }
  try { sock = dgram.createSocket('udp4'); } catch (e) { return cb({ servers: [] }); }
  sock.on('error', finish);
  sock.on('message', function (msg) {
    var m = /^location\s*:\s*(.+)$/im.exec(msg.toString('utf8'));
    if (m && /^https?:\/\//i.test(m[1].trim())) found[m[1].trim()] = true;
  });
  sock.bind(0, function () {
    var send = function (st) {
      var b = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ' + st + '\r\n\r\n');
      try { sock.send(b, 0, b.length, 1900, '239.255.255.250'); } catch (e) {}
    };
    [0, 400, 800].forEach(function (d) { setTimeout(function () { if (!closed) { send('urn:schemas-upnp-org:device:MediaServer:1'); send('urn:schemas-upnp-org:service:ContentDirectory:1'); } }, d); });
  });
  setTimeout(finish, ms || 3500);
}

/* ---------- routes ---------- */
function send(res, ALLOW, code, obj) {
  var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  for (var k in ALLOW) h[k] = ALLOW[k];
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}
function hostOf(source) { try { return URL_.parse(str(source && (source.control || source.address))).hostname || ''; } catch (e) { return ''; } }
/* The catalogue opens once, on first use.  A failure is not remembered: the next request tries again. */
var catalogOpening = null, openCatalog = null, scanResults = {}, activeScanControls = {};
var SCAN_KEEP_MS = 300000, SCAN_KEEP = 2;
function catalog(cb) {
  if (openCatalog) return cb(null, openCatalog);
  if (catalogOpening) return catalogOpening.push(cb);
  catalogOpening = [cb];
  var root, Catalog;
  try { root = require('./kv').sub('media-v3'); Catalog = require('./media-catalog').Catalog; } catch (e) { var wait = catalogOpening; catalogOpening = null; return wait.forEach(function (f) { f(e); }); }
  new Catalog(root).open(function (e, lib) {
    var waiting = catalogOpening; catalogOpening = null;
    if (!e) openCatalog = lib;
    waiting.forEach(function (f) { f(e, lib); });
  });
}
/* A discovery scan waiting for the app to adopt it: at most SCAN_KEEP, for SCAN_KEEP_MS, and gone
   as soon as it is imported. */
function keepScan(result, continuation, source) {
  var now = Date.now();
  Object.keys(scanResults).forEach(function (k) { if (now - scanResults[k].at > SCAN_KEEP_MS) delete scanResults[k]; });
  var keys = Object.keys(scanResults).sort(function (a, b) { return scanResults[a].at - scanResults[b].at; });
  while (keys.length >= SCAN_KEEP) delete scanResults[keys.shift()];
  var handle = require('crypto').randomBytes(16).toString('hex');
  scanResults[handle] = { at: now, result: result, continuation: continuation, source: source };
  return handle;
}
function withoutFiles(r) { var out = {}; Object.keys(r).forEach(function (k) { if (k !== 'files') out[k] = r[k]; }); out.fileCount = r.files ? r.files.length : 0; return out; }
function libraryRequest(kind, q, req, res, ALLOW, log) {
  catalog(function (e, lib) {
    if (e) return send(res, ALLOW, 507, { error: 'STORAGE_UNAVAILABLE', message: 'The TV could not open the media library.' });
    var answer = function (err, result) { send(res, ALLOW, err ? 400 : 200, err ? { error: err.code || 'LIBRARY_ERROR', message: err.message } : result); };
    if (kind === 'migrate') return require('./media-migrate').migrate(lib, q, answer);
    if (kind === 'status') return answer(null, { schema: 3, revision: lib.revision });
    if (kind === 'source') { if (q.action === 'remove' && activeScanControls[q.sourceId]) activeScanControls[q.sourceId].paused = true; return lib.source(q, answer); }
    if (kind === 'progress') return lib.progress(q, answer);
    if (kind === 'continue') return lib.continuing(answer);
    if (kind === 'query') return lib.query(q, answer);
    if (kind === 'detail') return lib.detail(q, answer);
    if (kind === 'edit') { delete q._commandPrepared; delete q._single; return lib.edit(q, answer); }
    if (kind === 'adopt') {
      var pending = scanResults[q.scanHandle];
      if (!pending || Date.now() - pending.at > SCAN_KEEP_MS) { delete scanResults[q.scanHandle]; return answer({ code: 'SCAN_EXPIRED', message: 'Scan expired.  Rescan the source.' }); }
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(q.sourceId || '')) return answer({ code: 'INVALID_SCAN', message: 'Invalid source.' });
      // The scan stays whole until it is imported, so a failed adopt can be tried again.
      return lib.importScan(q.sourceId, pending.result, function (err, result) {
        if (err) return answer(err);
        delete scanResults[q.scanHandle];
        var source = {};
        Object.keys(pending.source || {}).forEach(function (k) { source[k] = pending.source[k]; });
        source.id = q.sourceId;
        require('./media-scan-jobs').save(source, pending.continuation, function (saveError) {
          if (saveError) log({ lv: 'warn', event: 'media checkpoint not saved', error: saveError.code || 'write' });
          answer(null, result);
        });
      });
    }
    lib.file(q.handle, function (err, file) {
      if (err || !file || !q.source || q.source.id !== file.sourceId) return answer({ code: 'NOT_FOUND', message: 'This file is no longer available from that source.' });
      var local = function (r) { if (r.url && r.url.indexOf('/media-stream/') === 0) r.url = 'http://127.0.0.1:' + req.connection.localPort + r.url; return r; };
      var resolved = function (r) {
        local(r);
        if (kind !== 'chapters' || r.error) { if (r.url) r.resumeKey = file.id; return answer(null, r); }
        require('./media-chapter-request').inspect(r.url, file.size, file.ext, answer);
      };
      if (file.url) return resolved({ url: file.url });
      resolve(q.source, file.path, resolved);
    });
  });
}
function scanRequest(q, req, res, ALLOW, log) {
  var t0 = Date.now(), host = hostOf(q.source), mode = q.source && q.source.contentMode || 'movies', discovering = mode === 'automatic' || mode === 'shows';
  var begin = function () {
    require('./media-scan-jobs').prepare(q.source, !!q.restart, function (jobError, prepared, ignored) {
      if (ignored) log({ lv: 'info', event: 'media checkpoint ignored', reason: ignored });
      prepared = prepared || q.source;
      var control = { paused: false };
      if (prepared && prepared.id) { activeScanControls[prepared.id] = control; prepared._control = control; }
      scan(prepared, function (r) {
        if (prepared && prepared.id && activeScanControls[prepared.id] === control) delete activeScanControls[prepared.id];
        r.contentMode = mode;
        var continuation = r._continuation; delete r._continuation;
        log({ lv: r.error ? 'warn' : 'info', event: 'media scan', host: host, movies: r.movies ? r.movies.length : 0, partial: !!r.partial, error: r.error || null, ms: Date.now() - t0 });
        r.episodeFiles = (r.files || []).filter(function (file) { return file.kind === 'episode'; }).length;
        // Movies only: the answer never waits on (or fails with) the show library or a checkpoint.
        if (!r.files) {
          return require('./media-scan-jobs').save(q.source, r.error ? prepared && prepared._continuation : continuation, function (saveError, saved) {
            if (saveError) log({ lv: 'warn', event: 'media checkpoint not saved', error: saveError.code || 'write' });
            r.resumable = !!(continuation && saved);
            send(res, ALLOW, 200, r);
          });
        }
        if (!(q.source && q.source.id)) {
          r.resumable = !!continuation;
          var response = withoutFiles(r); response.scanHandle = keepScan(r, continuation, q.source);
          return send(res, ALLOW, 200, response);
        }
        catalog(function (err, lib) {
          if (err) return send(res, ALLOW, 507, { error: 'STORAGE_UNAVAILABLE', message: 'The scan could not be saved.  Your old library is kept.' });
          lib.importScan(q.source.id, r, function (saveErr) {
            if (saveErr) return send(res, ALLOW, 507, { error: 'STORAGE_UNAVAILABLE', message: 'The scan could not be saved.  Your old library is kept.' });
            require('./media-scan-jobs').save(q.source, continuation, function (saveError, saved) {
              if (saveError) log({ lv: 'warn', event: 'media checkpoint not saved', error: saveError.code || 'write' });
              r.resumable = !!(continuation && saved);
              send(res, ALLOW, 200, withoutFiles(r));
            });
          });
        });
      });
    });
  };
  if (!(q.source && q.source.id)) return begin();
  catalog(function (e, lib) {
    if (e) { if (!discovering) return begin(); return send(res, ALLOW, 507, { error: 'STORAGE_UNAVAILABLE', message: 'The library could not be opened.' }); }
    lib.source({ action: 'configure', sourceId: q.source.id, contentMode: mode }, function (error) {
      if (error && discovering) return send(res, ALLOW, 400, { error: 'SOURCE_CHANGED', message: error.message });
      begin();
    });
  });
}
function handle(req, res, ALLOW, log) {
  var route = req.url.split('?')[0];
  var libraryRoute = /^\/media\/library\/(query|detail|edit|migrate|progress|continue|chapters|source|adopt|resolve|status)$/.exec(route);
  var subs = /^\/media\/subs\/(search|get|login)$/.exec(route);
  if (req.method !== 'POST' || (!libraryRoute && !subs && route !== '/media/scan/control' && route !== '/media/discover' && route !== '/media/scan' && route !== '/media/resolve' && route !== '/media/metadata')) return send(res, ALLOW, 404, { error: 'unknown media route' });
  var body = '', over = false, bodyBytes = 0, bodyLimit = libraryRoute ? 1048576 : 65536;
  if (req.setEncoding) req.setEncoding('utf8');
  req.on('data', function (c) { if (over) return; body += c; bodyBytes += Buffer.byteLength(c, 'utf8'); if (bodyBytes > bodyLimit) { over = true; send(res, ALLOW, 413, { error: 'too large' }); } });
  req.on('end', function () {
    if (over) return;
    var q; try { q = JSON.parse(body || '{}'); } catch (e) { return send(res, ALLOW, 400, { error: 'bad request' }); }
    if (!q || typeof q !== 'object' || Array.isArray(q)) return send(res, ALLOW, 400, { error: 'bad request' });
    if (libraryRoute) return libraryRequest(libraryRoute[1], q, req, res, ALLOW, log);
    if (subs) return require('./subtitles')[subs[1]](q, function (r) {
      log({ lv: r.error ? 'warn' : 'info', event: 'subtitles ' + subs[1], results: r.results ? r.results.length : undefined, error: r.error || null });
      send(res, ALLOW, 200, r);
    });
    if (route === '/media/scan/control') {
      var control = activeScanControls[q.sourceId]; if (control) control.paused = true;
      return send(res, ALLOW, 200, { paused: true });
    }
    if (route === '/media/metadata') {
      var metadataClient = require('./media-metadata').create({ credential: q.credential, refresh: !!q.refresh }), metadataClosed = false;
      var cancelMetadata = function () { metadataClosed = true; metadataClient.cancel(); };
      req.on('aborted', cancelMetadata); if (res.on) res.on('close', cancelMetadata);
      return metadataClient.lookup(q, function (e, r) { if (!metadataClosed) send(res, ALLOW, 200, e ? { error: 'metadata', message: e.message } : r); });
    }
    if (route === '/media/discover') return discover(function (r) { log({ lv: 'info', event: 'media discover', servers: r.servers.length }); send(res, ALLOW, 200, r); });
    if (route === '/media/scan') return scanRequest(q, req, res, ALLOW, log);
    var host = hostOf(q.source);
    resolve(q.source, q.path, function (r) {
      log({ lv: r.error ? 'warn' : 'info', event: 'media link', host: host, error: r.error || null });
      if (r.url && r.url.indexOf('/media-stream/') === 0) r.url = 'http://127.0.0.1:' + req.connection.localPort + r.url;
      send(res, ALLOW, 200, r);
    });
  });
}

/* The file servers a WebDAV service sends movies to: their links are signed, so logs keep only the host
   (proxy.js redact). */
var signedHosts = [];
function hideLinksFrom(host) {
  host = str(host).toLowerCase();
  if (host && signedHosts.indexOf(host) < 0) { signedHosts.push(host); if (signedHosts.length > 50) signedHosts.shift(); }
}
module.exports = { catalog: catalog, scanResults: scanResults, originKey: originKey, samePath: samePath, moviesOf: moviesOf, skipFolder: skipFolder, newSkipped: newSkipped, signedHosts: signedHosts, hideLinksFrom: hideLinksFrom, handle: handle, scan: scan, resolve: resolve, discover: discover, titleOf: titleOf, isJunk: isJunk, tokens: tokens, parseBrowse: parseBrowse, parsePropfind: parsePropfind, parseDevice: parseDevice, errorKind: errorKind };
