// Movies from a Radarr or Plex folder match on their own: the file's title, a year off by one, several of one name.
'use strict';
const assert = require('assert'), M = require('../../service/media-metadata'), fs = require('fs'), vm = require('vm');
function lookup(client, q) { return new Promise((res, rej) => client.lookup(q, (e, r) => e ? rej(e) : res(r))); }
const DB = {
  minecraft: [{ id: 950387, title: 'A Minecraft Movie', release_date: '2025-03-31', vote_count: 2500 }],
  'minecraft the movie': [{ id: 950387, title: 'A Minecraft Movie', release_date: '2025-03-31', vote_count: 2500 }],
  'a minecraft movie': [{ id: 950387, title: 'A Minecraft Movie', release_date: '2025-03-31', vote_count: 2500 }],
  moana: [{ id: 1167307, title: 'Moana', release_date: '2026-07-10', vote_count: 40 }, { id: 277834, title: 'Moana', release_date: '2016-10-13', vote_count: 13000 }],
  superman: [{ id: 1061474, title: 'Superman', release_date: '2025-07-09', vote_count: 3000 }, { id: 9999, title: 'Superman', release_date: '2025-01-01', vote_count: 2 }, { id: 1924, title: 'Superman', release_date: '1978-12-14', vote_count: 4000 }],
  'the evil dead': [{ id: 764, title: 'The Evil Dead', release_date: '1983-04-15', vote_count: 4800, also: '1981' }],
  hag: [{ id: 2, title: 'Hag', release_date: '2025-05-01', vote_count: 8 }, { id: 3, title: 'HAG', release_date: '2025-01-01', vote_count: 0 }],
  'a marvel television special presentation - the punisher one last kill': [{ id: 1439930, title: 'The Punisher: One Last Kill', release_date: '2026-05-12', vote_count: 2416 }],
  'borat subsequent moviefilm': [{ id: 740985, title: 'Borat Subsequent Moviefilm: Delivery of Prodigious Bribe to American Regime for Make Benefit Once Glorious Nation of Kazakhstan', release_date: '2020-10-23', vote_count: 3000 }],
  'paul mccartney man on the run': [{ id: 1260643, title: 'Man on the Run', release_date: '2026-02-19', vote_count: 39 }],
  'titan the oceangate disaster': [{ id: 1426306, title: 'Titan: The OceanGate Submersible Disaster', release_date: '2025-06-11', vote_count: 206 }],
  'unsinkable titanic untold': [{ id: 1159452, title: 'Unsinkable', release_date: '2024-03-01', vote_count: 16 }],
  'blood brothers dragons embers': [{ id: 1278164, title: 'Blood Brothers: Bara Naga', release_date: '2025-03-01', vote_count: 24 }],
  twins: [{ id: 1, title: 'Twins', release_date: '1988-12-09', vote_count: 30 }, { id: 2, title: 'Twins', release_date: '1988-01-01', vote_count: 25 }]
};
const calls = [];
const client = M.create({ credential: 'demo', read: (url, h, cb) => {
  calls.push(url);
  const m = /\/movie\/([0-9]+)/.exec(url);
  if (m && !url.includes('/search/')) return cb(null, { id: +m[1], title: 't' + m[1], release_date: '2025-01-01', genres: [], images: { posters: [] } });
  const q = decodeURIComponent(/query=([^&]*)/.exec(url)[1]).replace(/\+/g, ' ').toLowerCase(), y = (/year=(\d{4})/.exec(url) || [])[1];
  cb(null, { results: (DB[q] || []).filter((r) => !y || r.release_date.slice(0, 4) === y || r.also === y) });   // TMDB's year: any release that year
} });
(async () => {
  let r = await lookup(client, { title: 'Minecraft The Movie', year: '2025', alts: [{ title: 'A Minecraft Movie', year: '2025' }], auto: true });
  assert.equal(r.metadata && r.metadata.id, 'tmdb:950387', 'the file name has TMDB\'s title');
  r = await lookup(client, { title: 'Minecraft The Movie', year: '2025', auto: true });
  assert.equal(r.metadata && r.metadata.id, 'tmdb:950387', 'without "A" and "The Movie" it is the same name');
  r = await lookup(client, { title: 'Moana', year: '2025', auto: true });
  assert.equal(r.metadata && r.metadata.id, 'tmdb:1167307', 'a year off by one: the 2026 film, not the 2016 one');
  r = await lookup(client, { title: 'Superman', year: '2025', auto: true });
  assert.equal(r.metadata && r.metadata.id, 'tmdb:1061474', 'two of that name and year: the far better known one');
  r = await lookup(client, { title: 'The Evil Dead', year: '1981', auto: true });
  assert.equal(r.metadata && r.metadata.id, 'tmdb:764', 'TMDB found it for 1981, though its own date is 1983');
  r = await lookup(client, { title: 'Hag', year: '2025', auto: true });
  assert.equal(r.metadata && r.metadata.id, 'tmdb:2', 'the only one anyone has voted on');
  r = await lookup(client, { title: 'Twins', year: '1988', auto: true });
  assert(!r.metadata && r.matches.length === 2, 'two about as well known: chosen by hand');
  // Part of the name: a release named with more, or less, than TMDB's title (one film of that year fits).
  for (const [t, y, id] of [['A Marvel Television Special Presentation - The Punisher One Last Kill', '2026', 1439930], ['Borat Subsequent Moviefilm', '2020', 740985],
    ['Paul McCartney Man on the Run', '2025', 1260643], ['Titan The OceanGate Disaster', '2025', 1426306]]) {
    r = await lookup(client, { title: t, year: y, auto: true });
    assert.equal(r.metadata && r.metadata.id, 'tmdb:' + id, t);
  }
  r = await lookup(client, { title: 'Unsinkable Titanic Untold', year: '2024', auto: true });
  assert(!r.metadata, 'one word in common is not enough');
  r = await lookup(client, { title: 'Blood Brothers Dragons Embers', year: '2025', auto: true });
  assert(!r.metadata, 'the same first words, then a different film');
  // The app: IDs in a Radarr name are used as they are; else the file's title is a second name.
  const src = fs.readFileSync('app/js/media.js', 'utf8'), fn = /function namedIn\(m\) \{[\s\S]*?\n  \}\n/.exec(src)[0];
  const namedIn = vm.runInNewContext('(' + fn.replace('function namedIn', 'function') + ')');
  assert.equal(namedIn({ path: '/M/Superman (2025) {tmdb-1061474}/x.mkv', file: 'x.mkv' }).id, 'tmdb:1061474');
  assert.equal(namedIn({ path: '/M/Heat (1995) [imdbid-tt0113277]/Heat.mkv', file: 'Heat.mkv' }).id, 'tt0113277');
  const n = namedIn({ title: 'Minecraft The Movie', year: '2025', path: '/M/Minecraft The Movie (2025)/A Minecraft Movie (2025) WEBDL-2160p.mkv', file: 'A Minecraft Movie (2025) WEBDL-2160p.mkv' });
  assert.deepEqual(JSON.parse(JSON.stringify(n.alts)), [{ title: 'A Minecraft Movie', year: '2025' }]);
  assert.equal(namedIn({ title: 'X', file: 'The.Matrix.1999.1080p.BluRay.mkv' }).alts[0].title, 'The Matrix');
  // Shows from a Sonarr or Plex folder.
  const ssrc = fs.readFileSync('app/js/media-series.js', 'utf8'), sfn = /function showQuery\(t\)\{[\s\S]*?\n  \}\n/.exec(ssrc)[0];
  const showQuery = vm.runInNewContext('(' + sfn.replace('function showQuery', 'function') + ')');
  assert.deepEqual(JSON.parse(JSON.stringify(showQuery('Severance (2022)'))), { kind: 'tv', auto: true, year: '2022', title: 'Severance' });
  assert.equal(showQuery('The Bear (2022) {tmdb-136315}').id, 'tmdb:tv:136315');
  const tq = showQuery('Shogun (2024) [tvdbid-392573]'); assert.equal(tq.tvdb, '392573'); assert.equal(tq.title, 'Shogun'); assert.equal(tq.year, '2024');
  const tvCalls = [];
  const tv = M.create({ credential: 'demo', read: (url, h, cb) => {
    tvCalls.push(url);
    if (url.includes('/find/392573')) return cb(null, { tv_results: [{ id: 126308 }] });
    if (url.includes('/search/tv')) {
      const q = decodeURIComponent(/query=([^&]*)/.exec(url)[1]).toLowerCase(), y = (/first_air_date_year=(\d{4})/.exec(url) || [])[1];
      const all = { severance: [{ id: 95396, name: 'Severance', first_air_date: '2022-02-17', vote_count: 2000 }, { id: 5, name: 'Severance', first_air_date: '2006-01-01', vote_count: 9 }],
        'the office': [{ id: 2316, name: 'The Office', first_air_date: '2005-03-24', vote_count: 4000 }, { id: 2996, name: 'The Office', first_air_date: '2001-07-09', vote_count: 900 }],
        'big brother': [{ id: 10160, name: 'Big Brother', first_air_date: '2000-07-05', vote_count: 300, origin_country: ['US'] }, { id: 2, name: 'Big Brother', first_air_date: '2000-07-18', vote_count: 250, origin_country: ['GB'] }],
        'cold case - the tylenol murder': [{ id: 7, name: 'Cold Case: The Tylenol Murders', first_air_date: '2025-05-01', vote_count: 5 }],
        'ann droid': [{ id: 8, name: 'Ann Droid', first_air_date: '2026-01-01', vote_count: 0 }, { id: 9, name: 'AnnDroid', first_air_date: '2020-01-01', vote_count: 0 }],
        'doctor who': [{ id: 57243, name: 'Doctor Who', first_air_date: '2005-03-26', vote_count: 3000 }] }[q] || [];
      return cb(null, { results: all.filter((x) => !y || x.first_air_date.slice(0, 4) === y) });
    }
    const m = /\/tv\/([0-9]+)/.exec(url);
    cb(null, { id: +m[1], name: 'n' + m[1], overview: 'x', first_air_date: '2022-01-01', seasons: [] });
  } });
  let s1 = await lookup(tv, { kind: 'tv', title: 'Severance', year: '2022', auto: true }); assert.equal(s1.metadata.id, 'tmdb:tv:95396');
  s1 = await lookup(tv, { kind: 'tv', title: 'Severance', auto: true }); assert.equal(s1.metadata.id, 'tmdb:tv:95396', 'no year: the far better known');
  s1 = await lookup(tv, { kind: 'tv', title: 'The Office', year: '2005', auto: true }); assert.equal(s1.metadata.id, 'tmdb:tv:2316', 'the US one by its year');
  s1 = await lookup(tv, { kind: 'tv', title: 'Doctor Who', year: '2006', auto: true }); assert.equal(s1.metadata.id, 'tmdb:tv:57243', 'a year off by one: searched again without it');
  assert.equal(showQuery('Big Brother (US)').cc, 'US');
  s1 = await lookup(tv, Object.assign(showQuery('Big Brother (US)'), {})); assert.equal(s1.metadata.id, 'tmdb:tv:10160', 'the US one');
  s1 = await lookup(tv, { kind: 'tv', title: 'Cold Case - The Tylenol Murder', auto: true }); assert.equal(s1.metadata.id, 'tmdb:tv:7', 'plural or not');
  s1 = await lookup(tv, { kind: 'tv', title: 'Ann Droid', auto: true }); assert.equal(s1.metadata.id, 'tmdb:tv:8', 'written exactly so');
  s1 = await lookup(tv, { kind: 'tv', title: 'Shogun', year: '2024', tvdb: '392573', auto: true }); assert.equal(s1.metadata.id, 'tmdb:tv:126308', 'a TVDB ID');
  console.log('PASS media automatch (' + calls.length + ' requests)');
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
