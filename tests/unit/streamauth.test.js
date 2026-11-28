/* What a stream's server hands out and expects back (service/streamauth.js, issue #202): cookies go back to their
   host (and the hosts under a Domain), never to another; a manifest's CDN token goes on to the pieces in its folder
   that have none, not to other hosts or folders; and end to end through the relay, a piece is asked for with both. */
'use strict';
const http = require('http');
const A = require('../../service/streamauth.js');
let fail = 0; const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + x : '')); if (!c) fail++; };
A.remember('cdn.example.com', ['__hdnea__=st=1~exp=2~hmac=abc; Path=/; Domain=.example.com', 'sid=7; HttpOnly']);
ok('a cookie for the Domain goes to the hosts under it', /__hdnea__=st=1~exp=2~hmac=abc/.test(A.cookieFor('live.example.com')));
ok('a host-only cookie goes back to that host', /sid=7/.test(A.cookieFor('cdn.example.com')) && !/sid=7/.test(A.cookieFor('live.example.com')));
ok('never to another site', A.cookieFor('example.org') === '');
ok('the playlist\'s own Cookie comes first and wins', A.cookieFor('cdn.example.com', 'sid=9') === 'sid=9; __hdnea__=st=1~exp=2~hmac=abc');
A.remember('evil.test', ['x=1; Domain=example.com']);
ok('a server can\'t set cookies for someone else\'s domain', !/x=1/.test(A.cookieFor('cdn.example.com')));
A._reset();
ok('a manifest with a token is passed on as it is', A.pathFor('cdn.jio.test', '/bpk-tv/Star/dash/index.mpd?__hdnea__=st=1~hmac=z') === '/bpk-tv/Star/dash/index.mpd?__hdnea__=st=1~hmac=z');
ok('a piece in its folder gets the token', A.pathFor('cdn.jio.test', '/bpk-tv/Star/dash/Star-video=1272000-1.dash') === '/bpk-tv/Star/dash/Star-video=1272000-1.dash?__hdnea__=st=1~hmac=z');
ok('a piece with its own token keeps it', A.pathFor('cdn.jio.test', '/bpk-tv/Star/dash/a.dash?hdntl=q') === '/bpk-tv/Star/dash/a.dash?hdntl=q');
ok('another folder or another host: nothing added', A.pathFor('cdn.jio.test', '/bpk-tv/Other/a.dash') === '/bpk-tv/Other/a.dash' && A.pathFor('other.test', '/bpk-tv/Star/dash/a.dash') === '/bpk-tv/Star/dash/a.dash');
ok('a manifest without a CDN token is not remembered', A.pathFor('cdn2.test', '/x/index.mpd?id=5') === '/x/index.mpd?id=5' && A.pathFor('cdn2.test', '/x/a.dash') === '/x/a.dash');
A._reset();
// Through the relay: the manifest sets a cookie and has a token; the piece is asked for with both.
let seen = null;
const up = http.createServer((q, s) => {
  if (/\.mpd/.test(q.url)) { s.writeHead(200, { 'Content-Type': 'application/dash+xml', 'Set-Cookie': 'k=v; Path=/' }); return s.end('<MPD/>'); }
  seen = { url: q.url, cookie: q.headers.cookie || '' }; s.writeHead(200, { 'Content-Type': 'video/mp4' }); s.end('x');
});
const relay = require('../../service/proxy.js').create({});
up.listen(0, '127.0.0.1', () => relay.server.listen(0, '127.0.0.1', async () => {
  const R = 'http://127.0.0.1:' + relay.server.address().port + '/x/http/127.0.0.1:' + up.address().port;
  await (await fetch(R + '/tv/ch/index.mpd?__hdnea__=st=9~hmac=y')).text();
  await (await fetch(R + '/tv/ch/seg-1.dash')).text();
  ok('through the relay: the piece carries the cookie and the token', seen && seen.cookie === 'k=v' && seen.url === '/tv/ch/seg-1.dash?__hdnea__=st=9~hmac=y', JSON.stringify(seen));
  relay.server.close(); up.close();
  if (fail) { console.log(fail + ' failed'); process.exit(1); } else console.log('all stream cookie and token tests passed');
}));
