/* Mock Xtream Codes provider for demos, screenshots and end-to-end tests.
     node tests/mock/mock_provider.js            listens on http://127.0.0.1:8077
     login: any username and password (use demo / demo)
   Every channel, show and film here is made up.  Logos and posters are drawn as SVG on the fly.
   Streams come from tests/mock/media (bash scripts/demo/make-media.sh); without them, playback
   simply fails while everything else works. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const PORT = +process.env.MOCK_PORT || 8077;
const MEDIA = path.join(__dirname, 'media');
const CLIP_SECONDS = +process.env.DEMO_SECONDS || 120;   // length of the clips make-media.sh writes

/* ---------- catalogue ---------- */
// [category name, media clip, channel names, archive days or 0]
const LIVE = [
  ['US | News', 'news', ['Nova News 24 FHD', 'Nova News 24 HD', 'Nova News 24 SD', 'Metro Report HD', 'Global Desk FHD', 'Capitol Wire HD', 'Daybreak News HD', 'Weather Now HD', 'Market Pulse FHD', 'Civic Channel'], 3],
  ['US | Sports', 'sports', ['Summit Sports 1 FHD', 'Summit Sports 2 FHD', 'Arena Live HD', 'Fastbreak TV HD', 'Goal Line FHD', 'Racing Hub HD', 'Fight Night Network', 'Golf Green TV HD'], 2],
  ['US | Movies', 'movies', ['CineVault FHD', 'Starlight Movies HD', 'Retro Reels', 'Thrill Zone HD', 'Chuckle Channel HD', 'Indie Screen', 'Action Max FHD', 'Classic Cinema Club'], 0],
  ['US | Entertainment', 'ent', ['Prime Plaza HD', 'Home & Garden Plus', 'Kitchen Stars HD', 'Travel Trails FHD', 'Drama One HD', 'Reality Rush', 'Quiz Arena'], 7],
  ['US | Kids', 'kids', ['Tiny Town', 'Doodle TV HD', 'Cartoon Cove', 'Little Explorers', 'Toon Express HD'], 0],
  ['US | Documentary', 'docs', ['Planet Pulse FHD', 'Deep Blue Docs HD', 'History Vault', 'Science Spark HD', 'Wild Frontier FHD'], 3],
  ['US | Music', 'music', ['Neon Hits', 'Beat Lounge HD', 'Country Roads TV', 'Jazz Corner', 'Retro Radio TV'], 0],
  ['US | Local', 'local', ['Lakeside 7 (East)', 'River City 4', 'Valley 12 HD', 'Northshore 2'], 1],
  ['UK | News', 'intl', ['UK: Albion News HD', 'UK: Thames Today'], 0],
  ['UK | Sport', 'intl', ['UK: Pitchside 1', 'UK: Pitchside 2'], 0],
  ['FR | Cinéma', 'intl', ['FR: Cinéma Lumière', 'FR: Ciné Nuit HD'], 0],
  ['DE | Sport', 'intl', ['DE: Sport Nord', 'DE: Sport Süd HD'], 0],
  ['PPV EVENTS', 'ppv', ['PPV Event 1', 'PPV Event 2', 'PPV Event 3'], 0],
  ['US | Spanish', 'intl', [], 0]
];
const SHOWS = {
  news: [['Morning Briefing', 'The day\'s top stories, weather and traffic in one quick hour.'], ['World Tonight', 'A calm look at the biggest stories from around the globe.'], ['Business Hour', 'Markets, money and the companies making headlines.'], ['The Debate Room', 'Two sides, one table, and a moderator who keeps time.'], ['Weekend Wrap', 'Everything you missed this week, explained.'], ['Weather Watch', 'Forecasts for the week ahead, region by region.']],
  sports: [['Matchday Live', 'Full coverage of today\'s big game, with pre-game and post-game analysis.'], ['Highlights Hour', 'Every goal, dunk and buzzer-beater from the past 24 hours.'], ['Inside the Locker Room', 'Players and coaches, unfiltered.'], ['Fantasy Focus', 'Start, sit and sleeper picks for this week.'], ['Classic Rematch', 'A legendary game from the archive, fully restored.'], ['Racing Weekend', 'Qualifying and the main event, lap by lap.']],
  movies: [['The Lighthouse Keeper', 'A storm traps a stranger on a remote island with a keeper hiding a secret.'], ['Midnight Express Lane', 'A delivery driver gets one wrong package and one very long night.'], ['Paper Planes', 'Two old friends retrace a cross-country trip they took as kids.'], ['Iron Orchard', 'A family farm faces its toughest harvest.'], ['The Last Matinee', 'An old cinema\'s final screening brings the whole town together.'], ['Signal Lost', 'A space crew wakes up to silence from mission control.']],
  ent: [['Kitchen Showdown', 'Four home cooks, three rounds, one golden spatula.'], ['Dream Renovation', 'A tired house gets a top-to-bottom makeover.'], ['Road Trip Diaries', 'Hidden gems on America\'s back roads.'], ['Quiz Night Live', 'Contestants race the clock for the jackpot.'], ['The Neighborhood', 'Drama, gossip and secrets on Maple Street.'], ['Late Show Tonight', 'Guests, games and music to end the day.']],
  kids: [['Bubble Buddies', 'Underwater friends solve a mystery at the coral reef.'], ['Rocket Rangers', 'A tiny crew explores a new planet every day.'], ['Doodle Club', 'Draw along and learn shapes and colours.'], ['Dino Days', 'A curious dinosaur learns about the world.'], ['Bedtime Stories', 'Gentle tales to wind down the day.']],
  docs: [['Ocean Giants', 'Following blue whales on their longest migration.'], ['Lost Cities', 'Archaeologists uncover a city buried for a thousand years.'], ['How It\'s Built', 'From raw steel to finished bridge in sixty minutes.'], ['Wild Seasons', 'One forest, four seasons, and the animals that live there.'], ['Inside the Volcano', 'Scientists venture to the edge of an active crater.']],
  music: [['Top 20 Countdown', 'This week\'s biggest songs, counted down.'], ['Unplugged Sessions', 'Acoustic sets from today\'s favourite artists.'], ['Throwback Mix', 'Non-stop hits from the 80s and 90s.'], ['Live at the Lounge', 'A full concert from an intimate venue.']],
  local: [['Lakeside Morning', 'Local news, weather and community events.'], ['High School Friday', 'Tonight\'s big local game.'], ['Town Hall Live', 'Your council, your questions.'], ['Evening Report', 'The stories that matter to your neighbourhood.']],
  intl: [['Evening News', 'Headlines from home and abroad.'], ['Match of the Week', 'Full replay of the weekend\'s top fixture.'], ['Film of the Night', 'A celebrated feature from the archive.'], ['Talk of the Town', 'Conversation, culture and comedy.']],
  ppv: [['Championship Night', 'The main card, live.'], ['Undercard', 'Rising stars before the main event.'], ['Pre-Show', 'Build-up, interviews and predictions.']]
};
const MOVIE_CATS = ['New releases', 'Action', 'Comedy', 'Family'];
const MOVIES = [
  ['The Lighthouse Keeper', 0, 2025, 7.8, 'Thriller'], ['Midnight Express Lane', 1, 2024, 7.1, 'Action'], ['Paper Planes', 2, 2025, 8.2, 'Comedy, Drama'],
  ['Iron Orchard', 0, 2023, 7.4, 'Drama'], ['The Last Matinee', 3, 2024, 8.0, 'Family'], ['Signal Lost', 0, 2025, 7.6, 'Sci-Fi'],
  ['Copper Canyon', 1, 2022, 6.9, 'Western'], ['Two Left Feet', 2, 2023, 7.0, 'Comedy'], ['The Kite Festival', 3, 2025, 7.7, 'Family'],
  ['Northern Lights', 0, 2024, 7.9, 'Romance'], ['Breakpoint', 1, 2025, 7.2, 'Action'], ['Grandpa\'s Garage', 3, 2023, 7.5, 'Family, Comedy']
];
const SERIES = [
  ['Harbor Street', 2, 8.4, 'A small-town harbour and the families who keep it running.'],
  ['Kitchen Showdown', 3, 7.6, 'Home cooks compete for the golden spatula.'],
  ['Orbit', 2, 8.7, 'The first crew to live on the Moon, one season at a time.'],
  ['Case Files', 4, 8.1, 'Detectives reopen cold cases with new science.'],
  ['Rocket Rangers', 3, 7.9, 'Animated adventures for young explorers.'],
  ['Wild Seasons', 1, 8.9, 'One forest, four seasons.']
];
const PALETTE = ['#5B8CFF', '#33E1FF', '#8B5CF6', '#3DDC97', '#FF6A3D', '#FFB547', '#E5484D', '#14B8A6', '#FF4FA3', '#D6C440'];

let sid = 0;
const cats = [], streams = [];
LIVE.forEach(([cname, clip, names, arch], ci) => {
  cats.push({ category_id: String(ci + 1), category_name: cname, parent_id: 0 });
  names.forEach(n => {
    sid++;
    const base = n.replace(/^[A-Z]{2}: /, '').replace(/\s+(FHD|HD|SD)$/, '').replace(/\s*\(.*\)$/, '');
    const key = base.toLowerCase().replace(/[^a-z0-9]+/g, '.') + (cname.slice(0, 2) === 'US' ? '.us' : '.' + cname.slice(0, 2).toLowerCase());
    streams.push({ num: sid, name: (cname.slice(0, 2) === 'US' && !/PPV/.test(cname) ? 'US| ' : '') + n, stream_type: 'live', stream_id: sid, stream_icon: `http://127.0.0.1:${PORT}/logo/${sid}.svg`,
      epg_channel_id: sid % 9 === 0 ? '' : key, added: '1761000000', category_id: String(ci + 1), tv_archive: arch ? 1 : 0, tv_archive_duration: arch, clip, base, ci });
  });
});
function seeded(n) { let x = Math.sin(n) * 10000; return x - Math.floor(x); }
function schedule(ch) {
  const list = SHOWS[ch.clip] || SHOWS.ent, out = [], day = 86400000;
  let t = Math.floor((Date.now() - day) / 1800000) * 1800000, i = 0;
  const end = Date.now() + 2 * day;
  while (t < end) {
    const s = list[Math.floor(seeded(ch.stream_id * 31 + i) * list.length)], len = (1 + Math.floor(seeded(ch.stream_id * 7 + i) * 3)) * 30 * 60000;
    out.push({ s: t, e: t + len, t: s[0], d: s[1] }); t += len; i++;
  }
  return out;
}
// MOCK_CHAOS=1: a "TEST | Chaos" group of deliberately sloppy streams (tests/mock/chaos.js).
const CHAOS = process.env.MOCK_CHAOS ? require('./chaos') : null;
if (CHAOS) {
  const ci = cats.length;
  cats.push({ category_id: String(ci + 1), category_name: 'TEST | Chaos', parent_id: 0 });
  CHAOS.MODES.forEach(([id, name]) => streams.push({ num: id, name, stream_type: 'live', stream_id: id, stream_icon: '', epg_channel_id: '', added: '1761000000', category_id: String(ci + 1), tv_archive: 0, tv_archive_duration: 0, clip: 'news', base: name, ci }));
}
// MOCK_BIG=15000: a provider-sized playlist for speed tests (tests/soak/speed.js): that many extra
// channels in 25-channel groups named like real ones ("US | Sports 12"), MOCK_BIG_EPG of them
// (default 3000) with a guide, the rest without.  Logos are the same few SVGs, as real logos repeat.
const BIG = +process.env.MOCK_BIG || 0, BIG_EPG = process.env.MOCK_BIG_EPG != null ? +process.env.MOCK_BIG_EPG : 3000;
if (BIG) {
  const regions = ['US', 'UK', 'CA', 'DE', 'FR', 'ES', 'IT', 'NL', 'PT', 'AR', 'IN', 'AU'], kinds = ['News', 'Sports', 'Movies', 'Entertainment', 'Kids', 'Documentary', 'Music', 'Local'];
  const clips = { News: 'news', Sports: 'sports', Movies: 'movies', Entertainment: 'ent', Kids: 'kids', Documentary: 'docs', Music: 'music', Local: 'local' };
  const q = ['FHD', 'HD', 'SD', ''];
  for (let i = 0; i < BIG; i++) {
    const g = Math.floor(i / 25), r = regions[g % regions.length], k = kinds[Math.floor(g / regions.length) % kinds.length], n = Math.floor(g / (regions.length * kinds.length)) + 1;
    if (i % 25 === 0) cats.push({ category_id: String(1000 + g), category_name: r + ' | ' + k + ' ' + n, parent_id: 0 });
    const id = 100000 + i, base = r + ' ' + k + ' ' + (i % 25 + 1) + (n > 1 ? ' ' + String.fromCharCode(64 + n) : '');
    streams.push({ num: 1000 + i, name: r + ': ' + base + (q[i % 4] ? ' ' + q[i % 4] : ''), stream_type: 'live', stream_id: id, stream_icon: `http://127.0.0.1:${PORT}/logo/${1 + i % 60}.svg`,
      epg_channel_id: i < BIG_EPG ? 'big.' + i : '', added: '1761000000', category_id: String(1000 + g), tv_archive: i % 5 === 0 ? 1 : 0, tv_archive_duration: i % 5 === 0 ? 3 : 0, clip: clips[k], base, ci: g });
  }
}
// MOCK_EVENTS=1: event channels that carry the matchup and time in their names, the way league
// passes and pay-per-view are listed (see app/js/events.js), with times around now in US Eastern.
if (process.env.MOCK_EVENTS) {
  const et = (ms, o) => new Date(ms).toLocaleString('en-US', Object.assign({ timeZone: 'America/New_York' }, o));
  const md = ms => et(ms, { month: 'short', day: 'numeric' }), hm = ms => et(ms, { hour: 'numeric', minute: '2-digit' });
  const base = Math.floor(Date.now() / 1800000) * 1800000, H = 3600000;
  const EV = [
    ['Pay-Per-View Events', [
      [-1, t => `PPV 01 | UFC | Prelims | ${et(t, { weekday: 'short' })} ${md(t)} ${hm(t)} ET`],
      [1, t => `PPV 02 | UFC | Main Card: Rivera v Okafor | ${et(t, { weekday: 'short' })} ${md(t)} ${hm(t)} ET`],
      [26, t => `PPV 03 | BOXING | Hart v Mendez | ${et(t, { weekday: 'short' })} ${md(t)} ${hm(t)} ET`],
      [3, t => `PPV 04 | WWE Saturday Showdown @ ${hm(t)} EDT`]]],
    ['NCAA Basketball', [
      [-0.5, t => `NCAAB 001 | NORTH RIVER @ LAKESIDE STATE (M) | ${et(t, { month: 'numeric', day: 'numeric' }).replace('/', '.')} ${hm(t)} | ESPN+`],
      [2, t => `NCAAB 002 | PINE VALLEY @ EASTPORT (W) | ${et(t, { month: 'numeric', day: 'numeric' }).replace('/', '.')} ${hm(t)} | ESPN+`],
      [5, t => `NCAAB 003 | COASTAL TECH @ MIDLAND (M) | ${et(t, { month: 'numeric', day: 'numeric' }).replace('/', '.')} ${hm(t)} | ESPN+`]]],
    ['NFL Sunday Pass', [
      [4, t => `NFL 1 | ${md(t)} ${hm(t)} | Harbor City Gulls @ Ridgeback Rams`],
      [7, t => `NFL 2 | ${md(t)} ${hm(t)} | Prairie Bison @ Coastline Pilots`],
      [-30, t => `NFL 3 | ${md(t)} ${hm(t)} | Desert Hawks @ Summit Miners`]]]
  ];
  EV.forEach(([cname, list]) => {
    const ci = cats.length;
    cats.push({ category_id: String(ci + 1), category_name: cname, parent_id: 0 });
    list.forEach(([h, f], i) => { const id = 200000 + ci * 10 + i; streams.push({ num: id, name: f(base + h * H), stream_type: 'live', stream_id: id, stream_icon: '', epg_channel_id: '', added: '1761000000', category_id: String(ci + 1), tv_archive: 0, tv_archive_duration: 0, clip: 'sports', base: cname, ci }); });
  });
}
const sched = new Map(streams.filter(s => s.stream_id < 100000 || s.epg_channel_id).map(s => [s.stream_id, schedule(s)]));

/* ---------- artwork ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function logo(ch) {
  const col = PALETTE[ch.ci % PALETTE.length], words = ch.base.split(/\s+/), num = (ch.base.match(/\d+$/) || [''])[0];
  const mark = num || words.map(w => w[0]).join('').slice(0, 3).toUpperCase();
  const label = words.filter(w => !/^\d+$/.test(w)).slice(0, 2).join(' ').toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><rect x="6" y="18" width="104" height="104" rx="26" fill="${col}"/>` +
    `<text x="58" y="${num ? 88 : 84}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="${mark.length > 2 ? 36 : 48}" fill="#0b0e1a">${esc(mark)}</text>` +
    `<text x="122" y="64" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="${label.length > 9 ? 22 : 28}" fill="#ffffff">${esc(label.split(' ')[0] || '')}</text>` +
    `<text x="122" y="94" font-family="Inter,Arial,sans-serif" font-weight="600" font-size="${label.length > 9 ? 20 : 24}" fill="${col}">${esc(label.split(' ')[1] || '')}</text></svg>`;
}
function poster(title, i) {
  const a = PALETTE[i % PALETTE.length], b = PALETTE[(i + 3) % PALETTE.length], words = title.toUpperCase().split(' ');
  const lines = []; let cur = '';
  words.forEach(w => { if ((cur + ' ' + w).trim().length > 11) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; }); lines.push(cur.trim());
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#0b0e1a"/></linearGradient>` +
    `<radialGradient id="r" cx="0.7" cy="0.3" r="0.6"><stop offset="0" stop-color="${b}" stop-opacity=".7"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="300" height="450" fill="url(#g)"/><rect width="300" height="450" fill="url(#r)"/><circle cx="210" cy="150" r="70" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="10"/>` +
    lines.map((l, k) => `<text x="24" y="${330 + k * 40 - (lines.length - 1) * 20}" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="34" fill="#fff">${esc(l)}</text>`).join('') +
    `<text x="24" y="420" font-family="Inter,Arial,sans-serif" font-weight="600" font-size="16" fill="#fff" fill-opacity=".7">A TIVIBRO DEMO TITLE</text></svg>`;
}

/* ---------- XMLTV ---------- */
const xd = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 +0000`; };
function xmltv() {
  let o = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="TiviBro mock">\n';
  const seen = new Set();
  streams.forEach(s => { if (s.epg_channel_id && !seen.has(s.epg_channel_id)) { seen.add(s.epg_channel_id); o += `<channel id="${esc(s.epg_channel_id)}"><display-name>${esc(s.base)}</display-name><icon src="${esc(s.stream_icon)}"/></channel>\n`; } });
  // Guide-only channels so matching has something to find for the channels without an id.
  streams.filter(s => !s.epg_channel_id && sched.has(s.stream_id)).forEach(s => o += `<channel id="${esc(s.base.replace(/\W+/g, ''))}.guide"><display-name>${esc(s.base)}</display-name></channel>\n`);
  const done = new Set();
  streams.forEach(s => {
    if (!sched.has(s.stream_id)) return;
    const id = s.epg_channel_id || s.base.replace(/\W+/g, '') + '.guide';
    if (done.has(id)) return; done.add(id);
    sched.get(s.stream_id).forEach(p => o += `<programme start="${xd(p.s)}" stop="${xd(p.e)}" channel="${esc(id)}"><title>${esc(p.t)}</title><desc>${esc(p.d)}</desc></programme>\n`);
  });
  return o + '</tv>\n';
}

/* ---------- server ---------- */
function send(res, code, body, type) { res.writeHead(code, { 'Content-Type': type || 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
function stream(res, req, file, type) {
  const f = path.join(MEDIA, file);
  if (!fs.existsSync(f)) return send(res, 404, 'no demo media (run scripts/demo/make-media.sh)', 'text/plain');
  const size = fs.statSync(f).size, range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const a = +range[1], b = range[2] ? +range[2] : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, 'Access-Control-Allow-Origin': '*' });
    return fs.createReadStream(f, { start: a, end: b }).pipe(res);
  }
  if (type === 'video/mp2t') return live(res, f, size);
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(f).pipe(res);
}
// Live channels arrive at about real-time speed (a few seconds' head start, then paced), like a
// real provider.  Sending the whole file at once would make players think the stream ended.
function live(res, f, size) {
  const rate = size / CLIP_SECONDS, t0 = Date.now(), head = rate * 4;
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  const rs = fs.createReadStream(f, { highWaterMark: 64 * 1024 });
  let sent = 0, timer = null;
  rs.on('data', chunk => {
    sent += chunk.length; res.write(chunk);
    const ahead = sent - head - rate * (Date.now() - t0) / 1000;
    if (ahead > 0) { rs.pause(); timer = setTimeout(() => rs.resume(), 1000 * ahead / rate); }
  });
  rs.on('end', () => res.end());
  res.on('close', () => { clearTimeout(timer); rs.destroy(); });
}
let xmlCache = null;           // the big guide is built once (tens of MB)
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true), p = u.pathname, q = u.query;
  if (p === '/player_api.php') {
    const a = q.action || '';
    if (!a) return send(res, 200, { user_info: { username: q.username, auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 300 * 86400), max_connections: '2', active_cons: '0', allowed_output_formats: ['ts', 'm3u8'] },
      server_info: { url: '127.0.0.1', port: String(PORT), server_protocol: 'http', timezone: process.env.MOCK_EVENTS ? 'America/New_York' : 'UTC', timestamp_now: Math.floor(Date.now() / 1000) } });
    if (a === 'get_live_categories') return send(res, 200, cats);
    if (a === 'get_live_streams') return send(res, 200, streams.map(({ clip, base, ci, ...s }) => s));
    if (a === 'get_short_epg') {
      const now = Date.now(), list = (sched.get(+q.stream_id) || []).filter(x => x.e > now).slice(0, +q.limit || 6);
      return send(res, 200, { epg_listings: list.map(x => ({ title: b64(x.t), description: b64(x.d), start_timestamp: String(x.s / 1000), stop_timestamp: String(x.e / 1000) })) });
    }
    if (a === 'get_vod_categories') return send(res, 200, MOVIE_CATS.map((n, i) => ({ category_id: String(100 + i), category_name: n })));
    if (a === 'get_vod_streams') return send(res, 200, MOVIES.map((m, i) => ({ num: i + 1, name: m[0], stream_id: 5000 + i, stream_icon: `http://127.0.0.1:${PORT}/poster/m${i}.svg`, rating: String(m[3]), category_id: String(100 + m[1]), container_extension: 'mp4', added: String(1761000000 - i * 86400) })));
    if (a === 'get_vod_info') { const i = +q.vod_id - 5000, m = MOVIES[i] || MOVIES[0]; return send(res, 200, { info: { plot: (SHOWS.movies[i % SHOWS.movies.length] || ['', ''])[1], genre: m[4], cast: 'Alex Rivera, Jordan Lee, Sam Okafor', director: 'Morgan Hale', duration: '01:52:00', releasedate: m[2] + '-05-01', movie_image: `http://127.0.0.1:${PORT}/poster/m${i}.svg` }, movie_data: { stream_id: 5000 + i, container_extension: 'mp4' } }); }
    if (a === 'get_series_categories') return send(res, 200, [{ category_id: '200', category_name: 'Drama' }, { category_id: '201', category_name: 'Reality' }, { category_id: '202', category_name: 'Kids' }]);
    if (a === 'get_series') return send(res, 200, SERIES.map((s, i) => ({ num: i + 1, name: s[0], series_id: 7000 + i, cover: `http://127.0.0.1:${PORT}/poster/s${i}.svg`, plot: s[3], rating: String(s[2]), releaseDate: (2019 + i) + '-09-01', category_id: i === 1 ? '201' : i === 4 ? '202' : '200' })));
    if (a === 'get_series_info') {
      const i = +q.series_id - 7000, s = SERIES[i] || SERIES[0], eps = {};
      for (let se = 1; se <= s[1]; se++) eps[se] = Array.from({ length: 6 }, (_, k) => ({ id: String(80000 + i * 100 + se * 10 + k), episode_num: k + 1, title: `${s[0]} - S${String(se).padStart(2, '0')}E${String(k + 1).padStart(2, '0')} - ${['Pilot', 'New Neighbours', 'The Storm', 'Old Friends', 'Turning Point', 'Finale'][k]}`, container_extension: 'mp4', info: { duration: '00:44:00', plot: 'Episode ' + (k + 1) + ' of season ' + se + '.' } }));
      return send(res, 200, { info: { name: s[0], plot: s[3], cover: `http://127.0.0.1:${PORT}/poster/s${i}.svg` }, episodes: eps });
    }
    return send(res, 200, []);
  }
  if (p === '/xmltv.php' || p === '/guide.xml') return send(res, 200, BIG ? (xmlCache = xmlCache || xmltv()) : xmltv(), 'application/xml');
  // A zipped guide file, labelled the way many guide hosts do (no Content-Encoding): the helper unzips it.
  if (p === '/guide.xml.gz') return send(res, 200, require('zlib').gzipSync(BIG ? (xmlCache = xmlCache || xmltv()) : xmltv()), 'application/octet-stream');
  let m;
  if ((m = /^\/logo\/(\d+)\.svg$/.exec(p))) { const s = streams.find(x => x.stream_id === +m[1]); return s ? send(res, 200, logo(s), 'image/svg+xml') : send(res, 404, ''); }
  if ((m = /^\/poster\/([ms])(\d+)\.svg$/.exec(p))) { const t = m[1] === 'm' ? (MOVIES[+m[2]] || [''])[0] : (SERIES[+m[2]] || [''])[0]; return send(res, 200, poster(t, +m[2] + (m[1] === 's' ? 5 : 0)), 'image/svg+xml'); }
  if (CHAOS && (m = /^\/live\/(?:.*\/)?(9\d\d)\.(ts|m3u8)$/.exec(p)) && +m[1] >= 901) return CHAOS.serve(m[1], req, res, MEDIA);
  if ((m = /^\/(live|timeshift)\/.*?(\d+)\.(ts|m3u8)$/.exec(p))) { const s = streams.find(x => x.stream_id === +m[2]); return stream(res, req, (s ? s.clip : 'news') + '.ts', 'video/mp2t'); }
  if (/^\/(movie|series)\//.test(p)) return stream(res, req, 'movie.mp4', 'video/mp4');
  send(res, 404, 'not found', 'text/plain');
});
server.listen(PORT, '127.0.0.1', () => console.log(`mock provider on http://127.0.0.1:${PORT}  (${streams.length} channels, ${MOVIES.length} films, ${SERIES.length} shows)`));
module.exports = server;
