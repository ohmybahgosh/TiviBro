/* A forgiving HTTP/1.x client, used only when Node's own parser refuses a provider's reply.
   Node's parser rejects replies that cheap IPTV panels really send: a stray control character in
   a header (refused by Node 8, webOS 5 and 6, which has no lenient option), Content-Length sent
   twice (refused by Node 12 and newer, webOS 22 on, even in lenient mode) and bare LF line
   endings.  When that happens the helper asks again through this reader, which:
     - accepts CRLF or bare LF line endings,
     - drops control characters from header values,
     - keeps a repeated Content-Length when the copies agree, and otherwise reads to the end,
     - undoes chunked transfer encoding,
   and hands back a readable stream with statusCode and headers, like http.IncomingMessage.
   One request per connection (Connection: close), so a body without a length ends with the
   connection.  Plain ES5 for Node 0.12 (webOS 4). */
'use strict';
var net = require('net');
var tls = require('tls');
var stream = require('stream');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var MAX_HEAD = 64 * 1024;

function parseHead(text) {
  var lines = text.split(/\r?\n/), m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/.exec((lines[0] || '').trim());
  if (!m) return null;
  var headers = {}, lengths = [];
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i], c = line.indexOf(':');
    if (c <= 0) continue;
    var name = line.slice(0, c).replace(/[^\x21-\x7e]/g, '').toLowerCase();
    var value = line.slice(c + 1).replace(/[\x00-\x08\x0a-\x1f\x7f]/g, '').trim();
    if (!name) continue;
    if (name === 'content-length') { lengths.push(value); continue; }
    if (name === 'set-cookie') { (headers[name] = headers[name] || []).push(value); continue; }
    headers[name] = headers[name] != null ? headers[name] + ', ' + value : value;
  }
  // A repeated Content-Length is fine when every copy says the same; otherwise trust the connection end.
  var same = lengths.length && lengths.every(function (l) { return l === lengths[0]; }) && /^\d+$/.test(lengths[0]);
  if (same) headers['content-length'] = lengths[0];
  return { statusCode: +m[1], statusMessage: m[2] || '', headers: headers, lengthMismatch: lengths.length > 0 && !same };
}

/* Chunked transfer encoding, undone. */
function Dechunk() {
  stream.Transform.call(this);
  this.state = 'size'; this.line = ''; this.left = 0;
}
util.inherits(Dechunk, stream.Transform);
Dechunk.prototype._transform = function (b, enc, cb) {
  var i = 0;
  while (i < b.length && this.state !== 'done') {
    if (this.state === 'size' || this.state === 'crlf') {
      var nl = -1;
      for (var k = i; k < b.length; k++) if (b[k] === 10) { nl = k; break; }
      if (nl < 0) { if (this.state === 'size') this.line += b.slice(i).toString('binary'); i = b.length; break; }
      if (this.state === 'size') {
        this.line += b.slice(i, nl).toString('binary');
        var size = parseInt(this.line.trim().split(';')[0], 16);
        this.line = '';
        if (isNaN(size)) { return cb(new Error('bad chunk size')); }
        this.left = size;
        this.state = size === 0 ? 'done' : 'data';
      } else this.state = 'size';
      i = nl + 1;
      continue;
    }
    var take = Math.min(this.left, b.length - i);
    this.push(b.slice(i, i + take));
    this.left -= take; i += take;
    if (!this.left) this.state = 'crlf';
  }
  cb();
};

/* request(options, onResponse): options as for http.request (protocol, hostname, port, path,
   method, headers).  Returns an emitter with destroy(err) and setTimeout(ms, fn); emits 'error'. */
function request(o, onResponse) {
  var req = new EventEmitter(), https = o.protocol === 'https:', port = +o.port || (https ? 443 : 80);
  var sock, head = [], headLen = 0, res = null, failed = false, timer = null, timeoutMs = 0, onTimeout = null;
  function fail(e) {
    if (failed) return; failed = true;
    if (sock) sock.destroy();
    if (res) res.emit('error', e); else req.emit('error', e);
  }
  req.destroy = function (e) { if (e) fail(e); else { failed = true; if (sock) sock.destroy(); } };
  req.abort = req.destroy;
  req.setTimeout = function (ms, fn) { timeoutMs = ms; onTimeout = fn; if (sock) sock.setTimeout(ms); return req; };
  var connectOpts = { host: o.hostname, port: port };
  sock = https ? tls.connect({ host: o.hostname, port: port, servername: net.isIP(o.hostname) ? undefined : o.hostname, rejectUnauthorized: false })
               : net.connect(connectOpts);
  if (timeoutMs) sock.setTimeout(timeoutMs);
  sock.on('timeout', function () { if (onTimeout) onTimeout(); else fail(new Error('timeout')); });
  sock.on(https ? 'secureConnect' : 'connect', function () {
    var lines = [(o.method || 'GET') + ' ' + (o.path || '/') + ' HTTP/1.1', 'Host: ' + o.hostname + (o.port && +o.port !== (https ? 443 : 80) ? ':' + o.port : '')];
    var h = o.headers || {};
    Object.keys(h).forEach(function (k) { if (!/^(host|connection)$/i.test(k)) lines.push(k + ': ' + h[k]); });
    lines.push('Connection: close', '', '');
    sock.write(lines.join('\r\n'));
  });
  var body = null, left = -1;
  sock.on('data', function (d) {
    if (failed) return;
    if (body) return feed(d);
    head.push(d); headLen += d.length;
    var all = Buffer.concat(head), s = all.toString('binary'), end = -1, sep = 0;
    var a = s.indexOf('\r\n\r\n'), b = s.indexOf('\n\n');
    if (a >= 0 && (b < 0 || a <= b)) { end = a; sep = 4; } else if (b >= 0) { end = b; sep = 2; }
    if (end < 0) { if (headLen > MAX_HEAD) fail(new Error('reply headers too large')); return; }
    var p = parseHead(s.slice(0, end));
    if (!p) return fail(new Error('not an HTTP reply'));
    res = new stream.PassThrough();
    res.statusCode = p.statusCode; res.statusMessage = p.statusMessage; res.headers = p.headers; res.lenient = true;
    var noBody = o.method === 'HEAD' || p.statusCode === 204 || p.statusCode === 304 || (p.statusCode >= 100 && p.statusCode < 200);
    body = res;
    if (/chunked/i.test(p.headers['transfer-encoding'] || '')) {
      delete p.headers['transfer-encoding']; delete p.headers['content-length'];
      body = new Dechunk(); body.on('error', fail); body.pipe(res);
    } else if (p.headers['content-length'] != null) left = +p.headers['content-length'];
    if (noBody) left = 0;
    onResponse(res);
    var rest = all.slice(end + sep);
    if (left === 0) { finishBody(); return; }
    if (rest.length) feed(rest);
  });
  function feed(d) {
    if (left >= 0) { if (d.length > left) d = d.slice(0, left); left -= d.length; }
    if (d.length) body.write(d);
    if (left === 0) finishBody();
  }
  var ended = false;
  function finishBody() { if (ended) return; ended = true; body.end(); sock.destroy(); }
  sock.on('end', function () { if (failed) return; if (!res) return fail(new Error('connection closed before a reply')); if (left > 0) return fail(new Error('reply cut short')); finishBody(); });
  sock.on('error', function (e) { fail(e); });
  return req;
}

module.exports = { request: request, parseHead: parseHead, Dechunk: Dechunk };
