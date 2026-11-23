/* Subtitle files beside a video (service/sidecar.js): which belong to it, and their language. */
'use strict';
const S = require('../../service/sidecar.js')._test;
let fails = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const e = (name, dir) => ({ name, dir: !!dir, path: '/TV/St Denis Medical/Season 3/' + name });
const V = 'St.Denis.Medical.S03E03.1080p.WEB.h264.mkv';
let r = S.pick([e(V), e('St.Denis.Medical.S03E03.1080p.WEB.h264.srt'), e('St.Denis.Medical.S03E03.1080p.WEB.h264.en.forced.srt'), e('St.Denis.Medical.S03E04.1080p.WEB.h264.mkv'), e('St.Denis.Medical.S03E04.1080p.WEB.h264.en.srt')], V);
ok('the episode\'s own .srt and its forced one, not the next episode\'s', r.length === 2 && r[1].forced && r[1].lang === 'en', r);
r = S.pick([e('Movie (2020).mkv'), e('english.srt'), e('Subs', true)], 'Movie (2020).mkv');
ok('a folder with one video: any subtitle file there', r.length === 1, r);
r = S.pick([e('2_English.srt'), e('3_Spanish.srt'), e('4_English.SDH.srt')], V, 'own');
ok('Subs/<video>/2_English.srt: English, Spanish, English SDH', r.map((x) => x.lang + (x.sdh ? '+sdh' : '')).join() === 'en,es,en+sdh', r);
ok('".eng.srt" is English, ".pt-BR.srt" Brazilian', S.describe('Show.S01E01.eng.srt', 'Show.S01E01').lang === 'en' && S.describe('Show.S01E01.pt-br.srt', 'Show.S01E01').lang === 'pt-br');
const F = require("../../service/sidecar.js").fromServer([{ url: "http://192.168.1.5:8200/Captions/123.srt", lang: "eng" }, { url: "javascript:x" }, { url: "http://192.168.1.5:8096/Videos/9/Subtitles/2/Stream.srt" }]);
ok("a DLNA server's subtitles: two, English first, no other kinds of address", F.length === 2 && F[0].lang === "en" && F[1].path.indexOf("http") === 0, F);
// WebDAV end to end: a folder listing (PROPFIND), the Subs folder, and the file read with the login.
const http = require('http');
const files = { '/TV/Show/Season 1/': ['Show.S01E01.mkv', 'Show.S01E01.en.srt', 'Subs/'], '/TV/Show/Season 1/Subs/': ['Show.S01E01.es.srt'] };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (req.headers.authorization !== 'Basic ' + Buffer.from('u:p').toString('base64')) { res.writeHead(401); return res.end(); }
  if (req.method === 'PROPFIND') {
    const dir = p.replace(/\/?$/, '/'), list = files[dir];
    if (!list) { res.writeHead(404); return res.end(); }
    const r = (h, d) => `<D:response><D:href>${encodeURI(h)}</D:href><D:propstat><D:prop>${d ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>'}</D:prop></D:propstat></D:response>`;
    res.writeHead(207, { 'Content-Type': 'application/xml' });
    return res.end('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' + r(dir, true) + list.map((n) => r(dir + n, /\/$/.test(n))).join('') + '</D:multistatus>');
  }
  if (/\.srt$/.test(p)) { res.writeHead(200); return res.end('1\n00:00:01,000 --> 00:00:02,000\n' + p.split('/').pop() + '\n'); }
  res.writeHead(404); res.end();
});
srv.listen(0, '127.0.0.1', () => {
  const src = { type: 'webdav', address: 'http://127.0.0.1:' + srv.address().port + '/TV/', user: 'u', pass: 'p' }, Sc = require('../../service/sidecar.js');
  Sc.lookup(src, '/TV/Show/Season 1/Show.S01E01.mkv', (r) => {
    ok('WebDAV: the .en.srt beside it and the Spanish one in Subs', r.subs.map((x) => x.lang).sort().join() === 'en,es', JSON.stringify(r));
    Sc.get(src, (r.subs.filter((x) => x.lang === 'es')[0] || {}).path, 'es', (g) => {
      ok('...read with the login', /Show\.S01E01\.es\.srt/.test(g.text || ''), JSON.stringify(g));
      // Load a subtitle file: the library's own folder first, folders before files, no videos.
      Sc.browse(src, '/TV/Show/Season 1', (b) => {
        ok('browse: the Subs folder first, then the .srt, no video', b.entries.map((x) => x.name + (x.dir ? '/' : '')).join() === 'Subs/,Show.S01E01.en.srt', JSON.stringify(b));
        srv.close();
        console.log(fails ? fails + ' FAILED' : 'all sidecar subtitle checks passed'); process.exit(fails ? 1 : 0);
      });
    });
  });
});
