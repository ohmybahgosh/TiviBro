/* Finding the provider's server: the TV's own DNS (the default), or one picked in Settings > Playlists and accounts > DNS
   (discussion #60): a public DNS server (Cloudflare, Google, Quad9, ControlD or one you type), or DNS over HTTPS
   (Cloudflare, Google, ControlD or one you type; IPv4 and IPv6 servers; Quad9's answers only HTTP/2 there, which old Node can't speak), for a provider whose name the TV's DNS doesn't find or blocks.  Every request the helper makes looks
   names up through dns.lookup, so that is what is replaced; addresses, local names and IPv6-only asks go to the
   TV's DNS as before, and so does a name the chosen DNS can't answer (better a blocked answer than none).
   Answers are kept for their TTL (1 to 30 minutes).
     POST /net/dns  { mode, server }   (with TiviBro's secret)   ->  { mode, server }
     GET  /net/dns                                               ->  { mode, server, ok, failed, last }
   Plain ES5 for Node 0.12 (webOS 4). */
'use strict';
var dns = require('dns'), https = require('https');
var orig = dns.lookup;
var PRESET = {
  cloudflare: ['1.1.1.1', '1.0.0.1'], google: ['8.8.8.8', '8.8.4.4'], quad9: ['9.9.9.9', '149.112.112.112'],
  controld: ['76.76.2.0', '76.76.10.0'], 'controld-uncensored': ['76.76.2.5', '76.76.10.5'],
  quad101: ['101.101.101.101', '101.102.103.104']          // TWNIC, Taiwan (discussion #60)
};
/* DNS over HTTPS, the standard form (RFC 8484: the DNS message itself, sent as ?dns=), which all of these answer.
   Each is tried at its addresses in turn: 1.1.1.1 is blocked in some places, and 1.0.0.1 then answers (discussion
   #60).  ControlD's is only at a name, which the TV's own DNS finds (never this file's lookup: that would ask
   itself). */
var DOH = {
  'doh-cloudflare': { hosts: ['1.1.1.1', '1.0.0.1'], path: '/dns-query' },
  'doh-google': { hosts: ['8.8.8.8', '8.8.4.4'], path: '/dns-query' },
  'doh-controld': { hosts: ['freedns.controld.com'], path: '/p0' },
  'doh-controld-uncensored': { hosts: ['freedns.controld.com'], path: '/uncensored' }
};
// The DoH services' own names are always found by the TV's DNS: looked up here, they would ask themselves.
function isBoot(h) {
  var all = [testDoh, customDoh].concat(Object.keys(DOH).map(function (k) { return DOH[k]; }));
  for (var i = 0; i < all.length; i++) if (all[i] && all[i].hosts.indexOf(h) >= 0) return true;
  return false;
}
var mode = 'tv', custom = '', customList = [], customDoh = null, cache = {}, stats = { ok: 0, failed: 0, last: '' };
var IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/, IPV6 = /^[0-9a-f:.]*:[0-9a-f:.]*$/i;
/* A typed server (discussion #60: "can new DoH servers be typed in?  It seemed IPv4 only"): one or two plain DNS
   servers, IPv4 or IPv6 ("101.101.101.101, 2001:de4::101"), or a DNS-over-HTTPS address ("https://dns.example/dns-query"). */
function parseCustom(s) {
  s = String(s || '').trim();
  var m = /^https:\/\/([^\/:?#\s]+|\[[0-9a-f:]+\])(?::(\d{1,5}))?(\/[^\s]*)?$/i.exec(s);
  if (m) { var d = { hosts: [m[1].replace(/^\[|\]$/g, '')], path: m[3] || '/dns-query' }; if (m[2]) d.port = +m[2]; return { doh: d, list: [] }; }
  var list = s.split(/[\s,;]+/).filter(function (x) { return x && (IPV4.test(x) && x.split('.').every(function (n) { return +n <= 255; }) || IPV6.test(x)); }).slice(0, 3);
  return { doh: null, list: list };
}

function isAddress(h) { return IPV4.test(h) || h.indexOf(':') >= 0; }
function isLocal(h) { return h === 'localhost' || !/\./.test(h) || /\.(?:local|lan|home|internal)$/i.test(h); }
var testServers = null, testDoh = null;        // tests: a DNS server on another port, a DoH server
function servers() { return testServers || (mode === 'custom' ? customList : PRESET[mode] || []); }

// A plain DNS server: dns.Resolver (Node 8 on), or on Node 0.12 the module's own servers, which dns.lookup doesn't use.
var resolver = null;
function viaServer(host, cb) {
  var list = servers();
  if (!list.length) return cb(new Error('no DNS server'));
  try {
    var r = dns.Resolver ? (resolver || (resolver = new dns.Resolver())) : dns;
    r.setServers(list);
    r.resolve4(host, function (e, ips) {
      if (!e && ips && ips.length) return cb(null, ips[0], 300, 4);
      // A name with only an IPv6 address (AAAA): that, when the TV has IPv6.
      r.resolve6(host, function (e6, ips6) { if (e6 || !ips6 || !ips6.length) return cb(e || e6 || new Error('no answer')); cb(null, ips6[0], 300, 6); });
    });
  } catch (e) { cb(e); }
}
// DNS over HTTPS.  The question: one A record for host, as a DNS message (RFC 1035), in base64url.
function buf(x, enc) { return Buffer.from(x, enc); }      // compat.js gives Node 0.12 Buffer.from
function question(host, type) {
  var b = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];             // id 0, recursion wanted, one question
  host.split('.').forEach(function (l) { if (!l) return; b.push(l.length); for (var i = 0; i < l.length; i++) b.push(l.charCodeAt(i) & 0x7f); });
  b.push(0, 0, type || 1, 0, 1);                             // end of name, type A (1) or AAAA (28), class IN
  return buf(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// The answer: the first A record and its TTL, or null.
function skipName(m, i) {
  while (i < m.length) { var n = m[i]; if (n === 0) return i + 1; if ((n & 0xc0) === 0xc0) return i + 2; i += n + 1; }
  return -1;
}
function answer(m) {
  if (!m || m.length < 12 || (m[3] & 0x0f) !== 0) return null;
  var qd = m.readUInt16BE(4), an = m.readUInt16BE(6), i = 12;
  for (var q = 0; q < qd; q++) { i = skipName(m, i); if (i < 0) return null; i += 4; }
  for (var a = 0; a < an && i < m.length; a++) {
    i = skipName(m, i); if (i < 0 || i + 10 > m.length) return null;
    var type = m.readUInt16BE(i), ttl = m.readUInt32BE(i + 4), len = m.readUInt16BE(i + 8); i += 10;
    if (type === 1 && len === 4 && i + 4 <= m.length) return { ip: m[i] + '.' + m[i + 1] + '.' + m[i + 2] + '.' + m[i + 3], ttl: ttl, family: 4 };
    if (type === 28 && len === 16 && i + 16 <= m.length) { var g = []; for (var k = 0; k < 16; k += 2) g.push(m.readUInt16BE(i + k).toString(16)); return { ip: g.join(':'), ttl: ttl, family: 6 }; }
    i += len;
  }
  return null;
}
function viaHttps(host, cb, six) {
  var d = testDoh || (mode === 'custom' ? customDoh : DOH[mode]), hosts = d.hosts.slice(), q = question(host, six ? 28 : 1), why = null, answered = false;
  (function next() {
    var h = hosts.shift();
    // No A record where the service answered: its AAAA (an IPv6-only name).
    if (!h) return !six && answered ? viaHttps(host, function (e2, ip, ttl, fam) { e2 ? cb(why || e2) : cb(null, ip, ttl, fam); }, true) : cb(why || new Error('no answer'));
    var finished = false;
    function end(e, r, said) { if (finished) return; finished = true; if (said) answered = true; if (e || !r) { why = e || new Error('no answer'); return next(); } cb(null, r.ip, r.ttl || 300, r.family || 4); }
    var o = { host: h, path: d.path + (d.path.indexOf('?') < 0 ? '?' : '&') + 'dns=' + q, headers: { Accept: 'application/dns-message' }, rejectUnauthorized: true };
    if (d.port) o.port = d.port;
    if (d.ca) o.ca = d.ca;
    var req = https.get(o, function (res) {
      var parts = [], n = 0;
      res.on('data', function (c) { if (n < 65536) { parts.push(c); n += c.length; } });
      res.on('end', function () {
        if (res.statusCode !== 200) return end(new Error('HTTP ' + res.statusCode));
        var r = null; try { r = answer(Buffer.concat(parts)); } catch (e) {}
        end(r ? null : new Error('no answer'), r, true);
      });
    });
    req.on('error', function (e) { end(e); });
    req.setTimeout(5000, function () { req.abort(); end(new Error('timed out')); });
  })();
}
function resolve(host, cb) {
  var k = host.toLowerCase(), hit = cache[k];
  if (hit && hit.until > Date.now()) return cb(null, hit.ip, hit.fam || 4);
  (DOH[mode] || testDoh || (mode === 'custom' && customDoh) ? viaHttps : viaServer)(k, function (e, ip, ttl, fam) {
    if (e) return cb(e);
    var keys = Object.keys(cache); if (keys.length > 500) cache = {};
    cache[k] = { ip: ip, fam: fam || 4, until: Date.now() + Math.max(60, Math.min(1800, ttl || 300)) * 1000 };
    cb(null, ip, fam || 4);
  });
}
function lookup(host, opts, cb) {
  var args = arguments;
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (typeof opts === 'number') opts = { family: opts };
  opts = opts || {};
  if (mode === 'tv' || typeof host !== 'string' || !host || isAddress(host) || isLocal(host) || isBoot(host.toLowerCase()) || opts.family === 6) return orig.apply(dns, args);
  resolve(host, function (e, ip, fam) {
    if (e) { stats.failed++; stats.last = host + ': ' + (e.code || e.message) + ', the TV\'s DNS instead'; return orig.call(dns, host, opts, cb); }
    stats.ok++;
    if (opts.all) return cb(null, [{ address: ip, family: fam || 4 }]);
    cb(null, ip, fam || 4);
  });
}
function set(m, server) {
  m = String(m || 'tv');
  if (m !== 'tv' && m !== 'custom' && !PRESET[m] && !DOH[m]) m = 'tv';
  var pc = m === 'custom' ? parseCustom(server) : { doh: null, list: [] };
  mode = m; customDoh = pc.doh; customList = pc.list;
  custom = customDoh ? 'https://' + customDoh.hosts[0] + (customDoh.port ? ':' + customDoh.port : '') + customDoh.path : customList.join(', ');
  if (m === 'custom' && !custom) mode = 'tv';
  cache = {};
  dns.lookup = mode === 'tv' ? orig : lookup;
  return { mode: mode, server: custom };
}
function send(res, ALLOW, code, o) { var h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }; for (var k in ALLOW) h[k] = ALLOW[k]; res.writeHead(code, h); res.end(JSON.stringify(o)); }
function handle(req, res, ALLOW, log) {
  if (req.method !== 'POST') return send(res, ALLOW, 200, { mode: mode, server: custom, ok: stats.ok, failed: stats.failed, last: stats.last });
  var body = '';
  req.on('data', function (c) { if (body.length < 4096) body += c; });
  req.on('end', function () {
    var j = {}; try { j = JSON.parse(body); } catch (e) {}
    var was = mode, r = set(j.mode, j.server);
    if (log && r.mode !== was) log({ lv: 'info', event: 'dns', mode: r.mode, server: r.server });
    send(res, ALLOW, 200, r);
  });
}
module.exports = { set: set, handle: handle, lookup: lookup, _resolve: resolve, _servers: function (l) { testServers = l; cache = {}; }, _doh: function (d) { testDoh = d; cache = {}; }, _answer: answer, _question: question, _parse: parseCustom, get mode() { return mode; } };
