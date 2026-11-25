/* My media, helper side.  Finds and reads the viewer's own movie servers: DLNA (like a Fritz!Box, no
   login), WebDAV (like premiumize, with a login), Windows and Samba shares (SMB, through smb.js) and
   Dropbox (signed in from the phone app, see dropbox.js).  The app asks over /media/ routes, which need the
   helper's secret because a login goes through them (see proxy.js).

   Three things stay separate on purpose: a movie's id (from its stable path), its container, and the
   address it plays from.  At every play, WebDAV gives either a fresh signed link or
   a temporary localhost stream whose login stays in the helper (media-stream.js), and Dropbox a
   temporary link (Range works on it, so the player reads it directly).

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
var Dropbox = require('./dropbox');
var Gdrive = require('./gdrive');
var Smb = require('./smb');

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
// Dropbox has no address or password the viewer typed, so its words say what to do instead.
var DROPBOX_MESSAGES = {
  login: 'Dropbox didn\'t accept the sign-in.  Remove this source and add it again from the phone app.',
  address: 'That Dropbox folder or file isn\'t there any more.  Check it in Dropbox, or add the source again from the phone app.',
  unreachable: 'Dropbox did not answer.  Check the TV\'s internet connection and try again.'
};
// Google Drive signs in with a service account's key, given in the web editor or the phone app.
var GDRIVE_MESSAGES = {
  login: 'Google Drive didn\'t accept the key, or the service account can\'t see this folder.  Share the drive or folder with the service account\'s email (Viewer is enough).',
  address: 'That Google Drive folder or file isn\'t there any more, or isn\'t shared with the service account.',
  quota: 'Google Drive says this file has been downloaded too much today.  Try again later.',
  unreachable: 'Google Drive did not answer.  Check the TV\'s internet connection and try again.'
};
function failure(kind, source) {
  var words = source && source.type === 'dropbox' ? DROPBOX_MESSAGES : source && source.type === 'gdrive' ? GDRIVE_MESSAGES : {};
  return { error: kind, message: words[kind] || MESSAGES[kind] || MESSAGES.unreachable };
}
function gdriveFailure(e) { var k = e && e.kind; return failure(k === 'login' || k === 'address' || k === 'cert' || k === 'quota' ? k : 'unreachable', { type: 'gdrive' }); }
function dropboxFailure(e) { var k = e && e.kind; return failure(k === 'login' || k === 'address' || k === 'cert' ? k : 'unreachable', { type: 'dropbox' }); }

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
      var rre = /<res\b([^>]*)>([\s\S]*?)<\/res>/g, rm, subs = [];
      while ((rm = rre.exec(m[3]))) {
        var proto = attr(rm[1], 'protocolInfo');
        if (/:video\//i.test(proto) && !it.url) { it.url = unescapeXml(rm[2]).trim(); it.proto = proto; it.size = +attr(rm[1], 'size') || 0; }
        // Subtitles the server offers with the video (Jellyfin, Serviio, Universal Media Server): a res of their own.
        else if (/:(?:text\/(?:srt|vtt|x-subrip)|application\/x-subrip|smi\/caption)/i.test(proto)) subs.push({ url: unescapeXml(rm[2]).trim(), lang: attr(rm[1], 'language') || attr(rm[1], 'xml:lang') || '' });
      }
      // ...or as Samsung's caption tag (minidlna, Plex, Emby).
      var cre = /<sec:CaptionInfo(?:Ex)?\b[^>]*>([\s\S]*?)<\/sec:CaptionInfo(?:Ex)?>/gi, cm;
      while ((cm = cre.exec(m[3]))) subs.push({ url: unescapeXml(cm[1]).trim(), lang: '' });
      subs = subs.filter(function (x, i) { return /^https?:\/\//i.test(x.url) && x.url.length < 2000 && subs.map(function (y) { return y.url; }).indexOf(x.url) === i; }).slice(0, 6);
      if (subs.length) it.subs = subs;
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
      var entry = observed(source, file, ancestors, { id: 'd:' + u.pathname, size: it.size || 0, ext: extOf(file, it.proto), info: tokens(file), url: it.url, server: it.server, subs: it.subs });
      var prior=discovered[key];
      if(prior && prior.classification.review.length <= entry.classification.review.length && prior.ancestors.length >= entry.ancestors.length) entry=prior;
      var owner=pathOwners[u.pathname];
      if(owner && owner!==key){entry.id='d:'+key;flagCollision(entry);if(discovered[owner])flagCollision(discovered[owner]);}
      else pathOwners[u.pathname]=key;
      discovered[key] = entry;
      if (entry.kind !== 'movie' || source.contentMode === 'shows') return;
    }
    var t = titleOf(folderName, file);
    byPath[key] = { named: named, movie: { id: 'd:' + key, title: t.title, year: t.year, file: file, size: it.size || 0, ext: extOf(file, it.proto), info: tokens(file), url: it.url, subs: it.subs } };
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
        movies.push({ id: 'w:' + f.path, title: t.title, year: t.year, file: f.file, size: f.size, ext: extOf(f.file), info: tokens(f.file), path: f.path, mt: Date.parse(f.modified) || undefined });
      });
      next();
    });
  })();
}
/* ---------- Windows and Samba shares (SMB) ----------
   Folder by folder from the source's folder, like WebDAV: one run of the SMB program per folder (smb.js),
   the same budget, time limit and checkpoint, so a big share pauses and goes on.  Ids are s: + the path
   inside the share, which is also what a movie plays from. */
function scanSmb(source, cb) {
  var p = Smb.parts(source);
  if (p instanceof Error || !p.share) return cb(Smb.failure(p instanceof Error ? p : { kind: 'noshare' }));
  var saved = source._continuation || {};
  var movies = saved.movies || [], errors = saved.errors || [], partial = !!saved.partial, folders = 0, paused = false, deadline = Date.now() + SCAN_MS, stop = null, skipped = newSkipped();
  var queue = saved.queue || [{ path: p.folder, name: '', depth: 0, ancestors: [] }], visited = saved.visited || {}, discovered = saved.discovered || [];
  var budget = source.scanFolderBudget > 0 && source.scanFolderBudget <= MAX_FOLDERS ? source.scanFolderBudget : MAX_FOLDERS;
  function done() {
    if (stop) return cb(Smb.failure(stop));
    var result = { movies: movies, files: discovery(source) ? discovered : undefined, partial: partial, errors: errors, skipped: skipped };
    if (Smb.movedTo(source)) result.smbServer = Smb.movedTo(source);     // the app saves where the server is now
    if (paused) result._continuation = { queue: queue, visited: visited, movies: movies, discovered: discovered, errors: errors.filter(function (e) { return !/^stopped early/.test(e); }), partial: errors.some(function (e) { return !/^stopped early/.test(e); }) };
    cb(result);
  }
  (function next() {
    var c = queue.shift();
    if (!c || stop) return done();
    if ((source._control && source._control.paused) || Date.now() > deadline || folders >= budget) { queue.unshift(c); paused = true; partial = true; errors.push('stopped early, the library is very large'); return done(); }
    if (visited[c.path.toLowerCase()]) return next();
    visited[c.path.toLowerCase()] = true;
    folders++;
    Smb.list(source, c.path, function (e, entries) {
      if (e) {
        // The share itself failing (login, gone, unreachable) ends the scan; one folder failing doesn't.
        if (c.depth === 0 || e.kind === 'login' || e.kind === 'unreachable' || e.kind === 'program') { stop = e; return done(); }
        partial = true; errors.push(c.name + ': ' + (e.kind || e.message));
        return next();
      }
      var files = [];
      entries.forEach(function (it) {
        if (it.dir) {
          if (c.depth + 1 > (source.maxDepth || MAX_DEPTH)) { partial = true; errors.push('depth limit reached'); return; }
          if (!isJunk(it.name) && (discovery(source) || !skipFolder(it.name, skipped))) queue.push({ path: it.path, name: it.name, depth: c.depth + 1, ancestors: c.ancestors.concat([it.name]) });
          return;
        }
        if (discovery(source) ? VIDEO.test(it.name) : isMovieFile(it.name)) files.push({ file: it.name, size: it.size, path: it.path, modified: it.mtime });
      });
      (discovery(source) ? files : moviesOf(files, skipped, c.name)).forEach(function (f) {
        var mod = f.modified ? new Date(f.modified).toUTCString() : undefined;
        if (discovery(source)) {
          var entry = observed(source, f.file, c.ancestors, { id: 's:' + f.path, size: f.size, ext: extOf(f.file), info: tokens(f.file), path: f.path, modified: mod });
          discovered.push(entry);
          if (entry.kind !== 'movie' || source.contentMode === 'shows') return;
        }
        var t = titleOf(discovery(source) ? safeMovieFolder(c.name, files) : c.name, f.file);
        movies.push({ id: 's:' + f.path, title: t.title, year: t.year, file: f.file, size: f.size, ext: extOf(f.file), info: tokens(f.file), path: f.path, mt: f.modified || undefined });
      });
      next();
    });
  })();
}
// A share's movie plays from a localhost link the SMB program fills (media-stream.js), Range and all.
function resolveSmb(source, path, cb) {
  var p = Smb.parts(source), f = Smb.cleanPath(path);
  if (p instanceof Error || !p.share || !f || f === '/') return cb(Smb.failure(p instanceof Error ? p : { kind: 'address' }));
  var reader = Smb.reader(source, f);
  reader.size(function (e) {
    if (e) return cb(Smb.failure(e));
    cb({ url: require('./media-stream').createReader(reader, extOf(f)) });
  });
}

// Signed redirects stay direct.  Servers serving the authenticated file themselves
// get a temporary localhost stream, shared by the player and subtitle Range reads.
function resolve(source, path, cb) {
  if (source && source.type === 'dropbox') return resolveDropbox(source, path, cb);
  if (source && source.type === 'gdrive') return resolveGdrive(source, path, cb);
  if (source && source.type === 'smb') return resolveSmb(source, path, cb);
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

/* ---------- Dropbox ----------
   One recursive listing of the source's folder (2000 entries a page, then /continue), so a page is
   what a folder is to WebDAV for the scan's budget.  Only video files are kept from it, and the
   cursor and those files go in the checkpoint, so a paused scan goes on from the next page.  Once
   the listing is whole (or a slice ends), the files are grouped by folder and go through the same
   rules as WebDAV: ids are x: + path_lower, paths (to play from) path_display, and the folder names
   below the source's folder are the ancestors titles and seasons come from. */
function dropboxSegments(rootLower, rootDepth, e) {
  var lower = str(e.path_lower), display = str(e.path_display);
  if (rootLower && lower.indexOf(rootLower + '/') !== 0) return null;
  var segs = display.split('/').filter(function (x) { return x !== ''; });
  if (segs.length !== lower.split('/').filter(function (x) { return x !== ''; }).length) return null;
  return segs.slice(rootDepth);
}
function dropboxResult(source, entries, partial, errors) {
  var gd = source.type === 'gdrive';
  var rootLower = gd ? '' : Dropbox.folderPath(source.root).toLowerCase(), rootDepth = rootLower ? rootLower.split('/').length - 1 : 0;
  var skipped = newSkipped(), folderSkip = {}, groups = {}, movies = [], discovered = [], deep = false, seen = {};
  entries.forEach(function (e) {
    if (e.tag !== 'file' || seen[e.path_lower]) return;
    var segs = dropboxSegments(rootLower, rootDepth, e);
    if (!segs || !segs.length) return;
    var name = segs[segs.length - 1], ancestors = segs.slice(0, -1);
    if (!(discovery(source) ? VIDEO.test(name) : isMovieFile(name))) return;
    if (ancestors.length > (source.maxDepth || MAX_DEPTH)) { deep = true; return; }
    for (var i = 0; i < ancestors.length; i++) {
      var key = ancestors.slice(0, i + 1).join('/').toLowerCase();
      if (!(key in folderSkip)) folderSkip[key] = isJunk(ancestors[i]) || (!discovery(source) && skipFolder(ancestors[i], skipped));
      if (folderSkip[key]) return;
    }
    seen[e.path_lower] = true;
    var parent = ancestors.join('/').toLowerCase();
    if (!groups[parent]) groups[parent] = { name: ancestors.length ? ancestors[ancestors.length - 1] : '', ancestors: ancestors, files: [] };
    // Google Drive: the file's id is what stays (names can repeat), and plays it: gd:<id>/<where it is>.
    groups[parent].files.push({ file: name, size: e.size || 0, id: gd ? 'g:' + e.gid : 'x:' + e.path_lower, path: gd ? 'gd:' + e.gid + e.path_display : e.path_display, etag: e.rev, modified: e.modified });
  });
  if (deep) { partial = true; errors.push('depth limit reached'); }
  Object.keys(groups).sort().forEach(function (k) {
    var g = groups[k];
    (discovery(source) ? g.files : moviesOf(g.files, skipped, g.name)).forEach(function (f) {
      if (discovery(source)) {
        var entry = observed(source, f.file, g.ancestors, { id: f.id, size: f.size, ext: extOf(f.file), info: tokens(f.file), path: f.path, etag: f.etag, modified: f.modified });
        discovered.push(entry);
        if (entry.kind !== 'movie' || source.contentMode === 'shows') return;
      }
      var t = titleOf(discovery(source) ? safeMovieFolder(g.name, g.files) : g.name, f.file);
      movies.push({ id: f.id, title: t.title, year: t.year, file: f.file, size: f.size, ext: extOf(f.file), info: tokens(f.file), path: f.path, mt: Date.parse(f.modified) || undefined });   // the file's date: Recently added on a first scan
    });
  });
  return { movies: movies, files: discovery(source) ? discovered : undefined, partial: partial, errors: errors, skipped: skipped };
}
function scanDropbox(source, cb) {
  if (!str(source.refresh)) return cb(failure('login', source));
  var saved = source._continuation || {}, deadline = Date.now() + SCAN_MS;
  var budget = source.scanFolderBudget > 0 && source.scanFolderBudget <= MAX_FOLDERS ? source.scanFolderBudget : MAX_FOLDERS;
  Dropbox.listAll(source, function (e, listed) {
    var errors = [], partial = false;
    if (e) {
      // Nothing listed yet, or the sign-in is gone: the scan fails and the saved list stays.
      if (e.kind === 'login' || !(listed && listed.entries.length)) return cb(dropboxFailure(e));
      partial = true; errors.push('Dropbox: ' + dropboxFailure(e).message);
    }
    var r = dropboxResult(source, listed.entries, partial, errors);
    if (!e && listed.more) {
      r.partial = true; r.errors.push('stopped early, the library is very large');
      r._continuation = { cursor: listed.cursor, entries: listed.entries };
    }
    cb(r);
  }, {
    cursor: saved.cursor || '', entries: saved.entries || [],
    keep: function (x) { return x.tag === 'file' && VIDEO.test(x.name); },
    stop: function (pages) { return !!(source._control && source._control.paused) || Date.now() > deadline || pages >= budget; }
  });
}
function resolveDropbox(source, path, cb) {
  if (str(path).charAt(0) !== '/') return cb(failure('address', source));
  Dropbox.tempLink(source, path, function (e, url) {
    if (e) return cb(dropboxFailure(e));
    try { hideLinksFrom(URL_.parse(url).host); } catch (x) {}
    cb({ url: url });
  });
}

/* ---------- Google Drive ----------
   Listed by gdrive.js (one flat listing of a shared drive, or folder by folder), then the same rules as
   Dropbox: folder names below the library's folder are the ancestors.  ids are g: + the file's id, and
   paths gd:<id>/<where>, so a file plays by its id.  The listing's state goes in the checkpoint. */
function scanGdrive(source, cb) {
  if (!Gdrive.parseKey(source.key)) return cb(failure('login', source));
  var saved = source._continuation || {}, deadline = Date.now() + SCAN_MS;
  var budget = source.scanFolderBudget > 0 && source.scanFolderBudget <= MAX_FOLDERS ? source.scanFolderBudget : MAX_FOLDERS;
  Gdrive.listAll(source, function (e, listed) {
    var errors = [], partial = false;
    if (e) {
      if (e.kind === 'login' || !(listed && listed.entries.length)) return cb(gdriveFailure(e));
      partial = true; errors.push('Google Drive: ' + gdriveFailure(e).message);
    }
    var r = dropboxResult(source, listed.entries, partial, errors);
    if (!e && listed.more) {
      r.partial = true; r.errors.push('stopped early, the library is very large');
      r._continuation = { gdrive: listed.state };
    }
    cb(r);
  }, {
    state: saved.gdrive || null,
    stop: function (pages) { return !!(source._control && source._control.paused) || Date.now() > deadline || pages >= budget; }
  });
}
function resolveGdrive(source, path, cb) {
  var id = Gdrive.idOf(path);
  if (!id) return cb(failure('address', source));
  if (!Gdrive.parseKey(source.key)) return cb(failure('login', source));
  // A first token now, so a refused key says so here rather than as a stream that won't start.
  Gdrive.accessToken(source.key, function (e) {
    if (e) return cb(gdriveFailure(e));
    cb({ url: require('./media-stream').create(Gdrive.fileUrl(id), Gdrive.authorizer(source.key), extOf(str(path).split('/').pop())) });
  });
}

/* ---------- has anything changed? ----------
   A quick look for new media, like Plex's, without listing everything or keeping a copy of the tree in memory:
   one small request per library, compared with the last answer (q.token).  cb({ token, changed }).
     Dropbox  the changes since a cursor (Dropbox keeps them): only video files added, moved or deleted count.
     WebDAV   the library folder and its folders, each name with its ETag and date (Nextcloud's ETags change
              when anything inside does; others when a folder is added or renamed at the top).
     DLNA     the server's SystemUpdateID, which goes up on any change (Plex, Jellyfin, Emby, MiniDLNA). */
function fingerprint(lines) { return require('crypto').createHash('sha1').update(lines.sort().join('\n')).digest('hex').slice(0, 20); }
function changeCheck(source, prev, cb) {
  prev = str(prev);
  var type = source && source.type;
  function out(token, changed) { cb({ token: token, changed: !!(prev && token && token !== prev) || !!changed }); }
  if (type === 'dropbox') {
    if (!str(source.refresh)) return cb(failure('login', source));
    if (prev.indexOf('dbx:') !== 0) return Dropbox.latestCursor(source, function (e, c) { if (e) return cb(dropboxFailure(e)); cb({ token: 'dbx:' + c, changed: false }); });
    return Dropbox.changesSince(source, prev.slice(4), function (e, r) {
      if (e && e.kind === 'reset') return Dropbox.latestCursor(source, function (e2, c) { if (e2) return cb(dropboxFailure(e2)); cb({ token: 'dbx:' + c, changed: true }); });
      if (e) return cb(dropboxFailure(e));
      var media = r.entries.some(function (x) { return x.tag === 'deleted' || (x.tag === 'file' && VIDEO.test(x.name)); });
      cb({ token: 'dbx:' + r.cursor, changed: media || r.more, count: r.entries.filter(function (x) { return x.tag === 'file' && VIDEO.test(x.name); }).length });
    });
  }
  if (type === 'gdrive') {
    if (!Gdrive.parseKey(source.key)) return cb(failure('login', source));
    if (!source.driveId) return Gdrive.topFingerprint(source, function (e, f) { if (e) return cb(gdriveFailure(e)); out('gdt:' + f); });
    if (prev.indexOf('gdc:') !== 0) return Gdrive.startToken(source, function (e, t) { if (e) return cb(gdriveFailure(e)); cb({ token: 'gdc:' + t, changed: false }); });
    return Gdrive.changesSince(source, prev.slice(4), function (e, r) {
      if (e && e.kind === 'reset') return Gdrive.startToken(source, function (e2, t) { if (e2) return cb(gdriveFailure(e2)); cb({ token: 'gdc:' + t, changed: true }); });
      if (e) return cb(gdriveFailure(e));
      cb({ token: 'gdc:' + r.token, changed: r.changed, count: r.count });
    });
  }
  if (type === 'webdav') {
    var base = webdavBase(source);
    if (!base) return cb(failure('address'));
    return request({ url: base.origin + base.path, method: 'PROPFIND', secure: true, body: PROPFIND, headers: { Authorization: basic(source), Depth: '1', 'Content-Type': 'application/xml; charset="utf-8"', 'Content-Length': Buffer.byteLength(PROPFIND) } }, function (e, status, h, body) {
      if (e) return cb(failure(errorKind(e)));
      if (status === 401 || status === 403) return cb(failure('login'));
      if (status !== 207) return cb(failure('unreachable'));
      out('dav:' + fingerprint(parsePropfind(body).map(function (x) { return samePath(x.href) + '|' + x.etag + '|' + x.modified + '|' + (x.dir ? 'd' : x.size); })));
    });
  }
  /* A share: its folders three levels down, their times and how many files each holds, in one connection
     (Smb.tree): a new episode in Show/Season 1 changes that folder's time.  A program without tree: the top
     folder's names, sizes and times. */
  if (type === 'smb') return Smb.tree(source, 3, function (e, folders) {
    var moved = Smb.movedTo(source);
    function done(lines) { cb({ token: 'smb:' + fingerprint(lines), changed: !!(prev && prev !== 'smb:' + fingerprint(lines)), smbServer: moved || undefined }); }
    if (!e) return done(folders.map(function (x) { return x.path + '|' + x.mtime + '|' + x.files; }));
    if (e.kind !== 'other') return cb(Smb.failure(e));
    Smb.list(source, '', function (e2, entries) {
      if (e2) return cb(Smb.failure(e2));
      done(entries.map(function (x) { return x.name + '|' + x.mtime + '|' + (x.dir ? 'd' : x.size); }));
    });
  });
  if (type === 'dlna') {
    var soap = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetSystemUpdateID xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"></u:GetSystemUpdateID></s:Body></s:Envelope>';
    return request({ url: source.control, method: 'POST', body: soap, headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: '"urn:schemas-upnp-org:service:ContentDirectory:1#GetSystemUpdateID"', 'Content-Length': Buffer.byteLength(soap) } }, function (e, status, h, body) {
      var id = !e && status === 200 ? tag(body, 'Id') : '';
      if (/^[0-9]+$/.test(id)) return out('upnp:' + id);
      // A server without it: its top level, by name and update ID where it gives them.
      browseAll(source.control, '0', function (e2, items) { if (e2) return cb(failure(errorKind(e2))); out('upnp0:' + fingerprint((items || []).map(function (x) { return x.id + '|' + x.title + '|' + (x.size || ''); }))); });
    });
  }
  cb(failure('address'));
}
function scan(source, cb) {
  var type = source && source.type;
  if (type === 'dlna') return scanDlna(source, cb);
  if (type === 'webdav') return scanWebdav(source, cb);
  if (type === 'dropbox') return scanDropbox(source, cb);
  if (type === 'gdrive') return scanGdrive(source, cb);
  if (type === 'smb') return scanSmb(source, cb);
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
function hostOf(source) { if (source && source.type === 'dropbox') return 'dropbox'; if (source && source.type === 'gdrive') return 'gdrive'; if (source && source.type === 'smb') return str(source.server).replace(/:\d+$/, ''); try { return URL_.parse(str(source && (source.control || source.address))).hostname || ''; } catch (e) { return ''; } }
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
    if (kind === 'forget') return lib.forgetProgress(q, answer);       // Remove from Continue watching (a show)
    // Subtitle files beside an episode (service/sidecar.js): its file's folder on the source.
    if (kind === 'sidecar') return lib.file(q.handle, function (err, file) {
      if (err || !file || !q.source || q.source.id !== file.sourceId) return answer(null, { subs: [] });
      if (file.subs && file.subs.length) return answer(null, { subs: require('./sidecar').fromServer(file.subs) });   // a DLNA server's own
      if (!file.path) return answer(null, { subs: [] });
      require('./sidecar').lookup(q.source, file.path, function (r) { log({ lv: 'info', event: 'sidecar subtitles', found: r.subs.length, looked: r.looked, seen: r.seen }); answer(null, r); });
    });
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
        if (kind !== 'chapters' || r.error) { if (!r.url) return answer(null, r); r.resumeKey = file.id; return lib.progressOf ? lib.progressOf(file.id, function (e, p) { if (p) r.resumeAt = p; answer(null, r); }) : answer(null, r); }
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
/* The phone app's Dropbox folder picker (before the source exists), the account name, and signing out
   when a source is removed.  The refresh token comes in and never goes back out, nor into the log. */
function dropboxRequest(kind, q, res, ALLOW, log) {
  var refresh = str(q.refresh), path = str(q.path);
  function answer(e, out) {
    log({ lv: e ? 'warn' : 'info', event: 'dropbox ' + kind, folders: out && out.folders ? out.folders.length : undefined, error: e ? e.kind || 'unreachable' : null });
    send(res, ALLOW, 200, e && kind !== 'revoke' ? dropboxFailure(e) : out);
  }
  if (!/^[\x21-\x7e]{8,4096}$/.test(refresh)) { var none = new Error('no sign-in'); none.kind = 'login'; return answer(none, kind === 'revoke' ? { revoked: false } : null); }
  if (kind === 'revoke') return Dropbox.revoke(refresh, function (e) { answer(e, { revoked: !e }); });
  if (kind === 'account') return Dropbox.account(refresh, function (e, account) { answer(e, { account: account }); });
  if (path.length > 2000) { var bad = new Error('path'); bad.kind = 'address'; return answer(bad); }
  Dropbox.listFolder({ refresh: refresh }, path, function (e, folders) {
    if (e) return answer(e);
    Dropbox.account(refresh, function (e2, account) { answer(null, { folders: folders, account: e2 ? '' : account }); });
  });
}
/* Google Drive before a library exists: places (the account's email, its shared drives and the folders
   shared with it) and folders (one folder's folders), for the folder pickers.  The key comes with each
   ask and is never kept here or sent back. */
function gdriveRequest(kind, q, res, ALLOW, log) {
  var key = q.key;
  function answer(e, out) {
    log({ lv: e ? 'warn' : 'info', event: 'gdrive ' + kind, count: out && (out.places || out.folders) ? (out.places || out.folders).length : undefined, error: e ? e.kind || 'unreachable' : null });
    send(res, ALLOW, 200, e ? gdriveFailure(e) : out);
  }
  if (!Gdrive.parseKey(key)) { var none = new Error('no key'); none.kind = 'login'; return answer(none); }
  if (kind === 'places') return Gdrive.account(key, function (e, account) {
    if (e) return answer(e);
    Gdrive.places(key, function (e2, places) { answer(e2, { account: account, places: places }); });
  });
  if (!Gdrive.validId(q.parent) || (q.driveId && !Gdrive.validId(q.driveId))) { var bad = new Error('folder'); bad.kind = 'address'; return answer(bad); }
  Gdrive.folders(key, str(q.parent), str(q.driveId), function (e, folders) { answer(e, { folders: folders }); });
}
/* A share before a library exists, for the add-a-share forms: shares (the disk shares on a server),
   folders (one folder's folders), check (sign in and open the share) and discover (the SMB servers on the
   network, no login).  The login comes with each ask
   and is never kept here or sent back. */
function smbRequest(kind, q, res, ALLOW, log) {
  var source = { type: 'smb', server: q.server, host: q.name, share: q.share, folder: '/', user: q.user, pass: q.pass, domain: q.domain };
  function answer(e, out) {
    log({ lv: e ? 'warn' : 'info', event: 'smb ' + kind, host: hostOf(source), count: out && (out.shares || out.folders || out.servers) ? (out.shares || out.folders || out.servers).length : undefined, error: e ? e.kind || 'other' : null });
    send(res, ALLOW, 200, e ? Smb.failure(e) : out);
  }
  if (kind === 'discover') return require('./smb-discover').discover(function (r) { answer(null, r); });   // servers on the network (smb-discover.js)
  if (kind === 'shares') return Smb.shares(source, function (e, list) { answer(e, { shares: list }); });
  if (kind === 'check') return Smb.check(source, function (e, r) { answer(e, r); });
  Smb.list(source, q.path, function (e, entries) {
    answer(e, e ? null : { folders: entries.filter(function (x) { return x.dir && !isJunk(x.name); }).map(function (x) { return { name: x.name, path: x.path }; }) });
  });
}
function handle(req, res, ALLOW, log) {
  var route = req.url.split('?')[0];
  var libraryRoute = /^\/media\/library\/(query|detail|edit|migrate|progress|continue|chapters|source|adopt|resolve|status|sidecar)$/.exec(route);
  var subs = /^\/media\/subs\/(search|get|login)$/.exec(route), subscan = /^\/media\/subs\/(scan|lines)$/.exec(route);
  var dropbox = /^\/media\/dropbox\/(folders|account|revoke)$/.exec(route);
  var gdrive = /^\/media\/gdrive\/(places|folders)$/.exec(route);
  var smb = /^\/media\/smb\/(shares|folders|check|discover)$/.exec(route);
  if (req.method !== 'POST' || (!libraryRoute && !subs && !subscan && !dropbox && !gdrive && !smb && route !== '/media/scan/control' && route !== '/media/discover' && route !== '/media/scan' && route !== '/media/resolve' && route !== '/media/sidecar' && route !== '/media/sidecar/get' && route !== '/media/sidecar/browse' && route !== '/media/vformat' && route !== '/media/check' && route !== '/media/metadata' && route !== '/media/trakt' && route !== '/media/skipdb')) return send(res, ALLOW, 404, { error: 'unknown media route' });
  var body = '', over = false, bodyBytes = 0, bodyLimit = libraryRoute || subscan ? 1048576 : 65536;   // subscan: a long movie's Cluster offsets
  if (req.setEncoding) req.setEncoding('utf8');
  req.on('data', function (c) { if (over) return; body += c; bodyBytes += Buffer.byteLength(c, 'utf8'); if (bodyBytes > bodyLimit) { over = true; send(res, ALLOW, 413, { error: 'too large' }); } });
  req.on('end', function () {
    if (over) return;
    var q; try { q = JSON.parse(body || '{}'); } catch (e) { return send(res, ALLOW, 400, { error: 'bad request' }); }
    if (!q || typeof q !== 'object' || Array.isArray(q)) return send(res, ALLOW, 400, { error: 'bad request' });
    if (libraryRoute) return libraryRequest(libraryRoute[1], q, req, res, ALLOW, log);
    if (dropbox) return dropboxRequest(dropbox[1], q, res, ALLOW, log);
    if (gdrive) return gdriveRequest(gdrive[1], q, res, ALLOW, log);
    if (smb) return smbRequest(smb[1], q, res, ALLOW, log);
    // Subtitle lines of an MKV whose index covers only the video, read from the player's own download (service/subscan.js).
    if (subscan) return require('./subscan')[subscan[1]](q, function (r) {
      if (subscan[1] === 'scan') log({ lv: r.error ? 'warn' : 'info', event: 'subtitles from the passing file', error: r.error || null });
      send(res, ALLOW, 200, r);
    });
    if (subs) return require('./subtitles')[subs[1]](q, function (r) {
      log({ lv: r.error ? 'warn' : 'info', event: 'subtitles ' + subs[1], results: r.results ? r.results.length : undefined, error: r.error || null });
      send(res, ALLOW, 200, r);
    });
    // Subtitle files beside a movie, and one of them (service/sidecar.js).
    if (route === '/media/sidecar' && Array.isArray(q.subs) && q.subs.length) return send(res, ALLOW, 200, { subs: require('./sidecar').fromServer(q.subs) });
    if (route === '/media/sidecar') return require('./sidecar').lookup(q.source, q.path, function (r) { log({ lv: 'info', event: 'sidecar subtitles', found: r.subs.length, looked: r.looked, seen: r.seen }); send(res, ALLOW, 200, r); });
    if (route === '/media/sidecar/browse') return require('./sidecar').browse(q.source, q.path, function (r) { send(res, ALLOW, 200, r); });
    if (route === '/media/sidecar/get') return require('./sidecar').get(q.source, q.path, q.lang, function (r) { if (r.error) log({ lv: 'warn', event: 'sidecar subtitle', error: r.error }); send(res, ALLOW, 200, r); });
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
    // Trakt (service/trakt.js): what was asked and how it went, never a token or a code.
    if (route === '/media/trakt') return require('./trakt').handle(q, function (r) {
      log({ lv: r.error ? 'warn' : 'info', event: 'trakt ' + String(q.op || '').slice(0, 10), path: q.path ? String(q.path).split('/')[1] : undefined, error: r.error ? r.message : null });
      send(res, ALLOW, 200, r);
    });
    // Skip times from TheIntroDB and IntroDB (service/skipdb.js): what was found and where, never the TMDB key.
    if (route === '/media/skipdb') return require('./skipdb').lookup(q, function (r) {
      log({ lv: 'info', event: 'skip times', kind: q.kind === 'episode' ? 'episode' : 'movie', from: r.from ? r.from.join(',') || 'none' : undefined, error: r.error ? r.message : null });
      send(res, ALLOW, 200, r);
    });
    if (route === '/media/discover') return discover(function (r) { log({ lv: 'info', event: 'media discover', servers: r.servers.length }); send(res, ALLOW, 200, r); });
    if (route === '/media/scan') return scanRequest(q, req, res, ALLOW, log);
    var host = hostOf(q.source);
    // A movie's picture (2160p, HDR10, Dolby Vision) from its file's headers: media-vformat.js.
    if (route === '/media/check') {
      if (!q.source || typeof q.source !== 'object') return send(res, ALLOW, 400, { error: 'bad request' });
      return changeCheck(q.source, q.token, function (r) { if (r.changed) log({ lv: 'info', event: 'media changed', host: hostOf(q.source), count: r.count }); send(res, ALLOW, 200, r); });
    }
    if (route === '/media/vformat') return resolve(q.source, q.path, function (r) {
      if (r.error || !r.url) return send(res, ALLOW, 200, { error: r.error || 'resolve', message: r.message || 'Could not open that file.' });
      if (r.url.indexOf('/media-stream/') === 0) r.url = 'http://127.0.0.1:' + req.connection.localPort + r.url;
      require('./media-vformat').fromUrl(r.url, +q.size || 0, q.ext, function (e, f) {
        log({ lv: e ? 'warn' : 'info', event: 'media format', host: host, range: f && f.range || null, error: e ? e.message : null });
        send(res, ALLOW, 200, e ? { error: 'format', message: e.message } : f);
      });
    });
    resolve(q.source, q.path, function (r) {
      log({ lv: r.error ? 'warn' : 'info', event: 'media link', host: host, error: r.error || null });
      if (r.url && r.url.indexOf('/media-stream/') === 0) r.url = 'http://127.0.0.1:' + req.connection.localPort + r.url;
      send(res, ALLOW, 200, r);
    });
  });
}

/* The file servers a WebDAV service sends movies to: their links are signed, so logs keep only the host
   (proxy.js redact).  Dropbox's temporary links (any *.dropboxusercontent.com) always count, and stay
   first in the list. */
var signedHosts = ['dropboxusercontent.com'];
function hideLinksFrom(host) {
  host = str(host).toLowerCase();
  if (host && signedHosts.indexOf(host) < 0) { signedHosts.push(host); if (signedHosts.length > 50) signedHosts.splice(1, 1); }
}
module.exports = { basicAuth: basic, changeCheck: changeCheck, catalog: catalog, scanResults: scanResults, originKey: originKey, samePath: samePath, moviesOf: moviesOf, skipFolder: skipFolder, newSkipped: newSkipped, signedHosts: signedHosts, hideLinksFrom: hideLinksFrom, handle: handle, scan: scan, resolve: resolve, discover: discover, titleOf: titleOf, isJunk: isJunk, tokens: tokens, parseBrowse: parseBrowse, parsePropfind: parsePropfind, parseDevice: parseDevice, errorKind: errorKind, failure: failure };
