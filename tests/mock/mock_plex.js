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
  // Plex's catalogue (the same mock stands in for it): the Watchlist, and adding to it.
  if (/^\/(library\/sections\/watchlist\/all|actions\/(addTo|removeFrom)Watchlist)$/.test(p) && tok !== TOKEN && tok !== 'mock-kid-token') return [401, { error: 'unauthorized' }];
  if (p === '/library/sections/watchlist/all') return [200, { MediaContainer: { Metadata: [{ ratingKey: '5d776b59ad5437001f79c6f8', guid: 'plex://movie/5d776b59ad5437001f79c6f8', type: 'movie', title: 'Northbound' }, { ratingKey: '5d776b59ad5437001f79c6f9', guid: 'plex://movie/5d776b59ad5437001f79c6f9', type: 'movie', title: 'Not on the server' }] } }];
  if (/^\/actions\/(add|remove)FromWatchlist$|^\/actions\/addToWatchlist$/.test(p) && req.method === 'PUT') { state.watchlisted = p + '?' + q; return [200, null]; }
  if (tok !== SERVER_TOKEN) return [401, { error: 'unauthorized' }];
  if (p === '/identity') return [200, { MediaContainer: { machineIdentifier: MACHINE, version: '1.42.2' } }];
  if (p === '/library/sections') return [200, { MediaContainer: { Directory: [{ key: '1', type: 'movie', title: 'Movies', updatedAt: state.libChanged || 1 }] } }];
  if (p === '/status/sessions/history/all') return [200, { MediaContainer: { Metadata: [{ ratingKey: '10', viewedAt: state.viewedAt || 100 }] } }];
  if (p === '/library/sections/1/all' && /actor=902/.test(q)) { state.actor = true; return [200, { MediaContainer: { Metadata: [movie(18, 'Northbound'), movie(12, 'Paper Kingdoms')] } }]; }
  if (p === '/library/sections/1/all' && /guid=/.test(q)) { var g = decodeURIComponent((/guid=([^&]*)/.exec(q) || [])[1] || ''); return [200, { MediaContainer: { Metadata: g === 'plex://movie/5d776b59ad5437001f79c6f8' ? [movie(18, 'Northbound', { guid: g })] : [] } }]; }
  if (p === '/library/sections/1/all') { state.lastAll = q; var list = /unwatched=1/.test(q) ? MOVIES.slice(3) : MOVIES; return [200, { MediaContainer: { totalSize: list.length, Metadata: list.map(function (m, i) { return movie(10 + i, m); }) } }]; }
  if (p === '/photo/:/transcode') return state.realPng ? [200, PNG, 'image/png'] : [200, 'PNG:' + q, 'image/png'];
  if (p === '/hubs/continueWatching') return [200, { MediaContainer: { Hub: [{ title: 'Continue Watching', hubIdentifier: 'home.continue', Metadata: [movie(18, 'Northbound', { viewOffset: 2400000, lastViewedAt: 1700000500 }), episode(31, 4)] }] } }];
  if (p === '/hubs') return [200, { MediaContainer: { Hub: [
    { title: 'Continue Watching', hubIdentifier: 'home.continue', Metadata: [movie(18, 'Northbound')] },
    { title: 'Recently Added in Movies', hubIdentifier: 'home.movies.recent', Metadata: MOVIES.map(function (m, i) { return movie(10 + i, m); }) },
    { title: 'Recently Added in Music', hubIdentifier: 'home.music.recent', Metadata: [{ ratingKey: '90', title: 'An album', type: 'album', librarySectionID: 9 }] },
    { title: 'Friday Night Picks', hubIdentifier: 'collection.5', Metadata: MOVIES.slice(2, 7).map(function (m, i) { return movie(12 + i, m); }) }] } }];
  if (p === '/hubs/sections/1') return [200, { MediaContainer: { Hub: [{ title: 'Recently Released', Metadata: MOVIES.slice(0, 6).map(function (m, i) { return movie(10 + i, m); }) }, { title: 'Top Unwatched', Metadata: MOVIES.slice(4).map(function (m, i) { return movie(14 + i, m); }) }] } }];
  if (p === '/library/sections/1/collections') return [200, { MediaContainer: { Metadata: [{ ratingKey: '500', type: 'collection', title: 'The Copper Trilogy', childCount: 3, librarySectionID: 1 }] } }];
  if (p === '/library/collections/500/children') return [200, { MediaContainer: { Metadata: MOVIES.slice(0, 3).map(function (m, i) { return movie(10 + i, m); }) } }];
  if (p === '/library/sections/1/genre') return [200, { MediaContainer: { Directory: [{ title: 'Drama' }, { title: 'Comedy' }] } }];
  if (p === '/playlists') return [200, { MediaContainer: { Metadata: [{ ratingKey: '700', type: 'playlist', title: 'Movie Marathon', leafCount: 6 }] } }];
  if (p === '/hubs/search') {
    // The movies whose name has the words searched for (Copper Sky for anything else), Northbound with its TMDB id.
    var want = decodeURIComponent((/(?:^|&)query=([^&]*)/.exec(q) || [])[1] || '').toLowerCase(), hits = [];
    MOVIES.forEach(function (t, i) { if (want && t.toLowerCase().indexOf(want) >= 0) hits.push(movie(10 + i, t, t === 'Northbound' ? { Guid: [{ id: 'imdb://tt0999' }, { id: 'tmdb://999' }] } : {})); });
    state.searches = (state.searches || 0) + 1;
    return [200, { MediaContainer: { Hub: [{ title: 'Movies', Metadata: hits.length ? hits : [movie(10, 'Copper Sky')] }] } }];
  }
  if (p === '/library/metadata/18/clearLogo/1') { state.logo = true; return [200, PNG, 'image/png']; }
  if (/^\/library\/parts\/\d+$/.test(p) && req.method === 'PUT') { state.partPut = q; return [200, null]; }
  if (/^\/library\/parts\/7\/indexes\/sd\/\d+$/.test(p)) { state.preview = p; return [200, PNG, 'image/png']; }
  if (p === '/library/streams/3') { state.subFile = true; return [200, '1\n00:00:01,000 --> 00:00:04,000\nHello from Plex\n', 'text/plain']; }
  if (p === '/library/parts/7/1700000000/file.mkv') { state.range = req.headers.range; return [206, 'MKVBYTES', 'video/x-matroska']; }
  // A show (40) with three episodes (41 to 43), each playing the same file: for Up next and Still watching?
  if (p === '/library/metadata/40/allLeaves') return [200, { MediaContainer: { Metadata: [41, 42, 43].map(function (k, i) { return Object.assign(episode(k, i + 1), { grandparentRatingKey: '40', viewOffset: 0 }); }) } }];
  if (p === '/library/metadata/40') return [200, { MediaContainer: { Metadata: [{ ratingKey: '40', type: 'show', title: 'The Harbor Lights', year: 2025, theme: '/library/metadata/40/theme/1', childCount: 1, leafCount: 3, viewedLeafCount: 0, summary: 'A show.', librarySectionID: 2, Role: [{ tag: 'Ivy Moss', role: 'Keeper', id: 904 }], OnDeck: { Metadata: [Object.assign(episode(41, 1), { grandparentRatingKey: '40' })] } }] } }];
  if (p === '/library/metadata/40/children') return [200, { MediaContainer: { Metadata: [{ ratingKey: '45', type: 'season', title: 'Season 2', index: 2, leafCount: 3, parentRatingKey: '40', thumb: '/library/metadata/45/thumb/1' }] } }];
  var me = /^\/library\/metadata\/(4[1-3])$/.exec(p);
  if (me) return [200, { MediaContainer: { Metadata: [Object.assign(episode(+me[1], +me[1] - 40), { grandparentRatingKey: '40', viewOffset: 0, Media: [{ videoResolution: '1080', videoCodec: 'h264', container: 'mkv', bitrate: 8000, Part: [{ id: 7, key: '/library/parts/7/1700000000/file.mkv', Stream: [] }] }] })] } }];
  // Subtitle search (the server asks OpenSubtitles and the others): the list, and fetching one adds it to the title.
  if (/^\/library\/metadata\/\d+\/subtitles$/.test(p) && req.method === 'GET') { state.subSearch = q; return [200, { MediaContainer: { Stream: [{ key: '/opensubtitles/123', codec: 'srt', languageCode: 'spa', title: 'Northbound.2019.1080p.es', providerTitle: 'OpenSubtitles', score: '96', perfectMatch: true }] } }]; }
  if (/^\/library\/metadata\/\d+\/subtitles$/.test(p) && req.method === 'PUT') { state.subFetched = q; return [200, null]; }
  var md = /^\/library\/metadata\/(\d+)$/.exec(p);
  if (md) { var k = +md[1], old = k === 13; return [200, { MediaContainer: { Metadata: [movie(k, MOVIES[k - 10] || 'X', { Image: k === 18 ? [{ type: 'clearLogo', url: '/library/metadata/18/clearLogo/1' }] : undefined, guid: k === 18 ? 'plex://movie/5d776b59ad5437001f79c6f8' : undefined, viewOffset: k === 18 ? 2400000 : 0, librarySectionTitle: 'Movies', rating: 9.2, audienceRating: 8.8,
    Director: [{ tag: 'Ana Ruiz', id: 901 }], Role: [{ tag: 'Mara Quinn', role: 'Captain Vey', id: 902, thumb: '/library/metadata/18/thumb/1' }, { tag: 'Theo Lake', role: 'Pilot', id: 903 }],
    Collection: k === 18 ? [{ id: 500, tag: 'The Copper Trilogy' }] : undefined,
    Related: k === 18 ? { Hub: [{ title: 'More like Northbound', Metadata: [movie(11, 'Midnight Ferry'), movie(12, 'Paper Kingdoms')] }] } : undefined,
    Marker: [{ type: 'intro', startTimeOffset: 5000, endTimeOffset: 65000 }, { type: 'credits', startTimeOffset: 6900000, endTimeOffset: 7200000, final: true }],
    Chapter: [{ tag: 'Opening', startTimeOffset: 0, endTimeOffset: 600000 }, { tag: 'The ferry', startTimeOffset: 600000, endTimeOffset: 7200000 }],
    Extras: { Metadata: [{ ratingKey: '80', type: 'clip', subtype: 'trailer', title: 'Trailer' }] },
    Media: [{ videoResolution: '4k', videoCodec: old ? 'mpeg2video' : 'hevc', container: old ? 'mpeg' : 'mkv', audioChannels: 8, bitrate: 60000, Part: [{ id: 7, key: '/library/parts/7/1700000000/file.mkv', size: 58e9, indexes: 'sd', Stream: [{ id: 1, streamType: 1, DOVIPresent: true }, { id: 2, streamType: 2, displayTitle: 'English (TrueHD Atmos 7.1)', selected: true }, { id: 3, streamType: 3, displayTitle: 'English (SRT)', codec: 'srt', key: '/library/streams/3', language: 'English', selected: true }].concat(state.subFetched ? [{ id: 9, streamType: 3, displayTitle: 'Spanish (SRT)', codec: 'srt', language: 'Español' }] : []) }] }] })] } }]; }
  if (p === '/:/timeline') { state.timeline = q; return [200, null]; }
  // As a real server: no converter profile for webOS, so 400 unless the request names one.
  if (p === '/video/:/transcode/universal/start.m3u8' && !req.headers['x-plex-client-profile-name']) return [400, 'Bad Request', 'text/html'];
  if (p === '/video/:/transcode/universal/start.m3u8') { state.transcode = q; state.profileExtra = req.headers['x-plex-client-profile-extra'] || ''; return [200, '#EXTM3U\n', 'application/vnd.apple.mpegurl']; }
  if (p === '/:/scrobble' && req.method === 'GET') { state.scrobbled = q; return [200, null]; }
  return [404, { error: 'not here' }];
}

var MOVIES = ['Copper Sky', 'Midnight Ferry', 'Paper Kingdoms', 'Low Tide', 'Hollow Pines', 'Signal Fire', 'Ember Road', 'Atlas of Rain', 'Northbound', 'Glass Orchard'];
// A movie as Plex lists it, in library 1.
function movie(k, title, more) { return Object.assign({ ratingKey: String(k), key: '/library/metadata/' + k, type: 'movie', title: title, year: 2026 - (k % 7), contentRating: 'PG-13', duration: 7200000, summary: 'A summary of ' + title + '.', thumb: '/library/metadata/' + k + '/thumb/1', art: '/library/metadata/' + k + '/art/1', librarySectionID: 1 }, more || {}); }
function episode(k, n) { return { ratingKey: String(k), type: 'episode', title: 'Episode ' + n, grandparentTitle: 'The Harbor Lights', parentIndex: 2, index: n, viewOffset: 600000, duration: 2700000, thumb: '/library/metadata/' + k + '/thumb/1', librarySectionID: 2 }; }
// A 1-by-1 blue picture.
var PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function start(cb) {
  var state = { signedIn: false, seen: [] };
  var srv = http.createServer(function (req, res) {
    state.seen.push({ path: req.url, headers: req.headers });
    var r = route(state, req, srv.address().port);
    res.writeHead(r[0], { 'Content-Type': r[2] || 'application/json' });
    res.end(r[1] == null ? '' : typeof r[1] === 'string' || Buffer.isBuffer(r[1]) ? r[1] : JSON.stringify(r[1]));
  });
  srv.listen(0, '127.0.0.1', function () { cb({ port: srv.address().port, state: state, close: function (f) { srv.close(f); } }); });
}

module.exports = { start: start, TOKEN: TOKEN, SERVER_TOKEN: SERVER_TOKEN, MACHINE: MACHINE };
