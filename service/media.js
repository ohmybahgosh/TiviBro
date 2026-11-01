/* My media, helper side.  Finds and reads the viewer's own movie servers: DLNA (like a Fritz!Box, no
   login) and WebDAV (like premiumize, with a login).  The app asks over /media/ routes, which need the
   helper's secret because a login goes through them (see proxy.js).

   Three things stay separate on purpose: a movie's id (from its stable path), its container, and the
   address it plays from.  A WebDAV movie's address is a signed link that expires, so it is asked for
   again at every play and never kept.

   Logs name hosts only.  A login goes only to the host it was entered for, never after a redirect to
   another one, and certificates are always checked for WebDAV.
   Plain ES5 for Node 0.12 on webOS 4 (see compat.js). */
'use strict';
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
  address: 'That address does not work.  It has to start with http:// or https://.',
  noredirect: 'This server does not give a link TiviBro can play.'
};
function failure(kind) { return { error: kind, message: MESSAGES[kind] }; }

// opts: url, method, headers, body, secure (send the pinned certificates); cb(err, status, headers, bodyText)
function request(opts, cb) {
  var u; try { u = URL_.parse(opts.url); } catch (e) { return cb(e); }
  var isTls = u.protocol === 'https:', done = false;
  function finish(e, s, h, b) { if (!done) { done = true; cb(e, s, h, b); } }
  var o = { hostname: u.hostname, port: u.port || (isTls ? 443 : 80), path: u.path || '/', method: opts.method || 'GET', headers: opts.headers || {}, agent: false };
  if (isTls && opts.secure && u.hostname === 'webdav.premiumize.me') o.ca = CA;
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
function browseAll(control, id, cb) {
  var items = [];
  (function page(start) {
    request({ url: control, method: 'POST', body: browseBody(id, start), headers: {
      'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"', 'Content-Length': Buffer.byteLength(browseBody(id, start))
    } }, function (e, status, h, body) {
      if (e) return cb(e);
      if (status !== 200) return cb(new Error('HTTP ' + status));
      var p = parseBrowse(body);
      if (p.fault) return cb(new Error('the server refused'));
      if (start && p.items.length && p.items[0].id === items[0].id) return cb(new Error('the server repeated a page'));
      items = items.concat(p.items);
      if (p.items.length && items.length < p.total) return page(items.length);
      cb(null, items);
    });
  })(0);
}
function scanDlna(source, cb) {
  var control = str(source.control);
  if (!/^https?:\/\//i.test(control)) return cb(failure('address'));
  var byPath = {}, errors = [], partial = false, folders = 0, deadline = Date.now() + SCAN_MS;
  var queue = [{ id: '0', name: '', depth: 0 }];
  function add(it, folderName) {
    if (!it.url) return;
    var u = URL_.parse(it.url), file = lastPart(u.pathname);
    if (!VIDEO.test(file)) file = it.title + (/\.[A-Za-z0-9]{2,4}$/.test(it.title) ? '' : '.' + extOf('', it.proto));
    if (!isMovieFile(file)) return;
    var key = u.pathname, named = /\(\d{4}\)\s*$/.test(folderName), was = byPath[key];
    if (was && (was.named || !named)) return;
    var t = titleOf(folderName, file);
    byPath[key] = { named: named, movie: { id: 'd:' + key, title: t.title, year: t.year, file: file, size: it.size || 0, ext: extOf(file, it.proto), info: tokens(file), url: it.url } };
  }
  function done() {
    var movies = Object.keys(byPath).map(function (k) { return byPath[k].movie; });
    cb({ movies: movies, partial: partial, errors: errors });
  }
  (function next() {
    var c = queue.shift();
    if (!c) return done();
    if (Date.now() > deadline || folders >= MAX_FOLDERS) { partial = true; errors.push('stopped early, the server is very large'); return done(); }
    folders++;
    browseAll(control, c.id, function (e, items) {
      if (e) {
        if (c.depth === 0) return cb(failure(errorKind(e)));
        partial = true; errors.push(c.name + ': ' + e.message);
        return next();
      }
      items.forEach(function (it) {
        if (!it.dir) return add(it, c.name);
        if (isJunk(it.title) || (c.depth < 2 && SERVER_EXTRAS.test(it.title))) return;
        if (c.depth + 1 > MAX_DEPTH) { partial = true; return; }
        queue.push({ id: it.id, name: it.title, depth: c.depth + 1 });
      });
      next();
    });
  })();
}

/* ---------- WebDAV ---------- */
var PROPFIND = '<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
function basic(source) { return 'Basic ' + Buffer.from(str(source.user) + ':' + str(source.pass)).toString('base64'); }
function parsePropfind(raw) {
  var xml = str(raw).replace(/<(\/?)[A-Za-z0-9_-]+:/g, '<$1'), out = [], re = /<response\b[^>]*>([\s\S]*?)<\/response>/gi, m;
  while ((m = re.exec(xml))) {
    out.push({ href: tag(m[1], 'href'), name: tag(m[1], 'displayname'), dir: /<collection\s*\/?>/i.test(m[1]), size: +tag(m[1], 'getcontentlength') || 0 });
  }
  return out;
}
function webdavBase(source) {
  var u; try { u = URL_.parse(str(source && source.address)); } catch (e) { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  return { origin: u.protocol + '//' + u.host, path: u.pathname || '/' };
}
function scanWebdav(source, cb) {
  var base = webdavBase(source);
  if (!base) return cb(failure('address'));
  var movies = [], errors = [], partial = false, folders = 0, deadline = Date.now() + SCAN_MS, stop = null;
  var queue = [{ path: base.path, name: '', depth: 0 }];
  function done() { if (stop) return cb(failure(stop)); cb({ movies: movies, partial: partial, errors: errors }); }
  (function next() {
    var c = queue.shift();
    if (!c || stop) return done();
    if (Date.now() > deadline || folders >= MAX_FOLDERS) { partial = true; errors.push('stopped early, the library is very large'); return done(); }
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
      var self = c.path.replace(/\/+$/, '');
      parsePropfind(body).forEach(function (it) {
        var p = URL_.parse(it.href).pathname || it.href;
        if (p.replace(/\/+$/, '') === self) return;
        var name = it.name || lastPart(p);
        if (it.dir) {
          if (c.depth + 1 > MAX_DEPTH) { partial = true; return; }
          if (!isJunk(name)) queue.push({ path: p, name: name, depth: c.depth + 1 });
          return;
        }
        if (!isMovieFile(name)) return;
        var t = titleOf(c.name, name);
        movies.push({ id: 'w:' + p, title: t.title, year: t.year, file: name, size: it.size, ext: extOf(name), info: tokens(name), path: p });
      });
      next();
    });
  })();
}
// The address to play now.  The server answers with a redirect to a signed link on another host; the
// login stays behind.  A redirect on the same host and scheme still needs the login, so it is followed.
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
        if (tu.protocol + '//' + tu.host !== origin) return cb({ url: to });
        if (left > 0) return hop(to, left - 1);
      }
      cb(failure(status >= 200 && status < 300 ? 'noredirect' : 'unreachable'));
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
function handle(req, res, ALLOW, log) {
  var route = req.url.split('?')[0];
  if (req.method !== 'POST' || (route !== '/media/discover' && route !== '/media/scan' && route !== '/media/resolve' && route !== '/media/metadata')) return send(res, ALLOW, 404, { error: 'unknown media route' });
  var body = '', over = false;
  req.on('data', function (c) { if (over) return; body += c; if (body.length > 65536) { over = true; send(res, ALLOW, 413, { error: 'too large' }); } });
  req.on('end', function () {
    if (over) return;
    var q; try { q = JSON.parse(body || '{}'); } catch (e) { return send(res, ALLOW, 400, { error: 'bad request' }); }
    if (!q || typeof q !== 'object' || Array.isArray(q)) return send(res, ALLOW, 400, { error: 'bad request' });
    if (route === '/media/metadata') return require('./media-metadata').lookup(q, function (e, r) { send(res, ALLOW, 200, e ? { error: 'metadata', message: e.message } : r); });
    var t0 = Date.now(), host = hostOf(q.source);
    if (route === '/media/discover') return discover(function (r) { log({ lv: 'info', event: 'media discover', servers: r.servers.length }); send(res, ALLOW, 200, r); });
    if (route === '/media/scan') return scan(q.source, function (r) {
      log({ lv: r.error ? 'warn' : 'info', event: 'media scan', host: host, movies: r.movies ? r.movies.length : 0, partial: !!r.partial, error: r.error || null, ms: Date.now() - t0 });
      send(res, ALLOW, 200, r);
    });
    resolve(q.source, q.path, function (r) {
      log({ lv: r.error ? 'warn' : 'info', event: 'media link', host: host, error: r.error || null });
      send(res, ALLOW, 200, r);
    });
  });
}

module.exports = { handle: handle, scan: scan, resolve: resolve, discover: discover, titleOf: titleOf, isJunk: isJunk, tokens: tokens, parseBrowse: parseBrowse, parsePropfind: parsePropfind, parseDevice: parseDevice, errorKind: errorKind };
