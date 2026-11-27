/* A small stand-in for plex.tv and one Plex Media Server, for tests: the link-code sign-in, the account, its
   servers, Plex Home, and a server with one movie library.  Everything on 127.0.0.1.  start(cb) -> { port, close,
   state }: state.signedIn = true makes the next poll answer with a token. */
'use strict';
var http = require('http');

var TOKEN = 'mock-account-token-123', SERVER_TOKEN = 'mock-server-token-456', MACHINE = 'mockmachine0001';

// The answers, by path (plex.tv's under /api/v2, the server's at the root).
function route(state, req, port) {
  var p = req.url.split('?')[0], q = req.url.split('?')[1] || '', tok = req.headers['x-plex-token'];
  if (!req.headers['x-plex-client-identifier']) return [400, { error: 'no client id' }];
  if (p === '/api/v2/pins' && req.method === 'POST') return [201, { id: 4242, code: 'K7QX', expiresAt: new Date(Date.now() + 9e5).toISOString() }];
  if (p === '/api/v2/pins/4242') return [200, { id: 4242, code: 'K7QX', authToken: state.signedIn ? TOKEN : null, expiresAt: new Date(Date.now() + 9e5).toISOString() }];
  if (p.indexOf('/api/v2/') === 0 && tok !== TOKEN && tok !== 'mock-kid-token') return [401, { error: 'unauthorized' }];
  if (p === '/api/v2/user') return [200, { uuid: 'u1', username: 'hometheater', thumb: '', home: true, homeAdmin: true, subscription: { active: true } }];
  if (p === '/api/v2/resources') return [200, [
    { name: 'Home server', provides: 'server', clientIdentifier: MACHINE, owned: true, accessToken: SERVER_TOKEN, presence: true, productVersion: '1.42.2', httpsRequired: false,
      connections: [{ protocol: 'https', address: '10.9.9.9', port: 32400, uri: 'https://10-9-9-9.abc.plex.direct:32400', local: true, relay: false },
                    { protocol: 'http', address: '127.0.0.1', port: port, uri: 'http://127.0.0.1:' + port, local: false, relay: false }] },
    { name: 'A phone', provides: 'client,player', clientIdentifier: 'phone1', connections: [] }]];
  if (p === '/api/v2/home/users') return [200, { users: [{ uuid: 'u1', title: 'hometheater', admin: true }, { uuid: 'kid1', title: 'Kids', protected: true, restricted: true }] }];
  if (p === '/api/v2/home/users/kid1/switch') return /pin=1234/.test(q) ? [201, { authToken: 'mock-kid-token' }] : [403, { error: 'pin' }];
  if (tok !== SERVER_TOKEN) return [401, { error: 'unauthorized' }];
  if (p === '/identity') return [200, { MediaContainer: { machineIdentifier: MACHINE, version: '1.42.2' } }];
  if (p === '/library/sections') return [200, { MediaContainer: { Directory: [{ key: '1', type: 'movie', title: 'Movies' }] } }];
  if (p === '/library/sections/1/all') return [200, { MediaContainer: { totalSize: 1, Metadata: [{ ratingKey: '10', title: 'Copper Sky', year: 2026, type: 'movie' }] } }];
  if (p === '/:/scrobble' && req.method === 'GET') { state.scrobbled = q; return [200, null]; }
  return [404, { error: 'not here' }];
}

function start(cb) {
  var state = { signedIn: false, seen: [] };
  var srv = http.createServer(function (req, res) {
    state.seen.push({ path: req.url, headers: req.headers });
    var r = route(state, req, srv.address().port);
    res.writeHead(r[0], { 'Content-Type': 'application/json' });
    res.end(r[1] == null ? '' : JSON.stringify(r[1]));
  });
  srv.listen(0, '127.0.0.1', function () { cb({ port: srv.address().port, state: state, close: function (f) { srv.close(f); } }); });
}

module.exports = { start: start, TOKEN: TOKEN, SERVER_TOKEN: SERVER_TOKEN, MACHINE: MACHINE };
