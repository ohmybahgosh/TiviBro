/* TV series from TMDB: the helper's guide lookup (service/media-metadata.js guideTvLookup) and the app's
   Series (app/js/series.js): names cleaned, which guide programmes are series, the newest asks first,
   a season's episodes in one ask, answers kept.
     node tests/unit/series-tmdb.test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const MM = require('../../service/media-metadata.js');
let fails = 0;
const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  ' + String(x).slice(0, 300) : '')); if (!c) fails++; };

(async () => {
  // ---- the helper: a show of exactly that name, the best known one ----
  const asked = [];
  const SEARCH = { results: [
    { id: 11, name: 'The Office', first_air_date: '2001-07-09', popularity: 30, vote_count: 900 },
    { id: 22, name: 'The Office', first_air_date: '2005-03-24', popularity: 200, vote_count: 4000 },
    { id: 33, name: 'The Office Christmas Special', popularity: 500, vote_count: 9000 }] };
  const read = (url, h, cb) => {
    asked.push(url.replace(/[?&]api_key=[^&]+/, ''));
    if (/\/search\/tv\?query=The%20Office/.test(url)) return cb(null, SEARCH);
    if (/\/search\/tv\?query=Obscure/.test(url)) return cb(null, { results: [{ id: 44, name: 'Obscure', popularity: 1, vote_count: 3 }] });
    if (/\/search\/tv\?query=Ax%20Men&/.test(url)) return cb(null, { results: [{ id: 55, name: 'Ax Men', popularity: 9, vote_count: 12 }] });
    if (/\/search\/tv\?query=Modern%20Marvels%3A%20Ink&/.test(url)) return cb(null, { results: [{ id: 99, name: 'Ink Master', popularity: 30, vote_count: 400 }] });
    if (/\/search\/tv\?query=Modern%20Marvels&/.test(url)) return cb(null, { results: [{ id: 66, name: 'Modern Marvels', popularity: 12, vote_count: 30 }] });
    if (/\/search\/tv\?query=Hannah%20Montana&/.test(url)) return cb(null, { results: [{ id: 77, name: 'Hannah Montana', popularity: 60, vote_count: 2600 }] });
    if (/\/search\/tv\?query=Hannah%20Montana%20Forever&/.test(url)) return cb(null, { results: [] });
    if (/\/search\/tv\?query=(Second%20Chance%20Pets|Deal%20or%20No%20Deal%20Australia|Tamron%20Hall|House%20Of%20Payne|Looney%20Tunes|The%20Great%20American%20Journey|Cheaters)&/.test(url)) return cb(null, { results: ({
      'Second%20Chance%20Pets': [], 'Deal%20or%20No%20Deal%20Australia': [], 'Tamron%20Hall': [{ id: 90, name: 'The Tamron Hall Show', vote_count: 20 }],
      'House%20Of%20Payne': [{ id: 91, name: 'Tyler Perry\'s House of Payne', vote_count: 67 }], 'Looney%20Tunes': [{ id: 92, name: 'The Looney Tunes Show', vote_count: 592 }, { id: 93, name: 'Looney Tunes', vote_count: 2 }],
      'The%20Great%20American%20Journey': [{ id: 94, name: 'The Great American Journey', vote_count: 0 }],
      'Cheaters': [{ id: 95, name: 'Cheaters', origin_country: ['GB'], popularity: 9, vote_count: 12 }, { id: 96, name: 'Cheaters', origin_country: ['US'], popularity: 4, vote_count: 10 }] })[/query=([^&]+)&/.exec(url)[1]] });
    if (/\/search\/tv\?query=War&/.test(url)) return cb(null, { results: [{ id: 101, name: 'The War', origin_country: ['US'], popularity: 20, vote_count: 300 }, { id: 102, name: 'WAR', origin_country: ['GB'], popularity: 10, vote_count: 30 }] });
    if (/\/search\/tv\?query=Second%20Chance&/.test(url)) return cb(null, { results: [{ id: 97, name: 'Second Chance', vote_count: 300 }] });
    if (/\/search\/tv\?query=Deal%20or%20No%20Deal&/.test(url)) return cb(null, { results: [{ id: 98, name: 'Deal or No Deal', origin_country: ['US'], popularity: 30, vote_count: 400 }, { id: 99, name: 'Deal or No Deal', origin_country: ['AU'], popularity: 5, vote_count: 25 }] });
    if (/\/search\/tv\?query=The%20Great&/.test(url)) return cb(null, { results: [{ id: 100, name: 'The Great', vote_count: 900 }] });
    if (/\/search\/tv\?query=Tiny%20Show(%20Extra)?&/.test(url)) return cb(null, { results: [{ id: 78, name: 'Tiny Show', popularity: 1, vote_count: 6 }] });
    if (/\/search\/tv\?query=(Night|Night%20of%20the|Night%20of)&/.test(url)) return cb(null, { results: [{ id: 79, name: 'Night of', vote_count: 900 }] });
    if (/\/search\/tv\?query=Night%20of%20the%20Living&/.test(url)) return cb(null, { results: [] });
    if (/\/search\/tv\?query=Big%20Bang%20Theory&/.test(url)) return cb(null, { results: [{ id: 81, name: 'The Big Bang Theory', vote_count: 9000 }] });
    if (/\/search\/tv\?query=Rubble%20and%20Crew&/.test(url)) return cb(null, { results: [{ id: 82, name: 'Rubble & Crew', vote_count: 40 }] });
    if (/\/search\/tv\?query=(Ojciec%20Mateusz%202|Blue%203|Przyjaciele%208)&/.test(url)) return cb(null, { results: [] });
    if (/\/search\/tv\?query=Ojciec%20Mateusz&/.test(url)) return cb(null, { results: [{ id: 83, name: 'Ojciec Mateusz', original_name: 'Ojciec Mateusz', vote_count: 40 }] });
    if (/\/search\/tv\?query=Teen%20Mom%202&/.test(url)) return cb(null, { results: [{ id: 84, name: 'Teen Mom 2', vote_count: 60 }] });
    if (/\/search\/tv\?query=Przyjaciele&/.test(url)) return cb(null, { results: [{ id: 85, name: 'Friends', original_name: 'Friends', vote_count: 9000 }] });
    const m = /\/tv\/(\d+)\?/.exec(url);
    if (m) return cb(null, { id: +m[1], name: 'The Office', overview: 'Office life.', first_air_date: m[1] === '22' ? '2005-03-24' : '2001-07-09', genres: [{ name: 'Comedy' }], vote_average: 8.6, networks: [{ name: m[1] === '22' ? 'NBC' : 'BBC Two' }], credits: { cast: [{ name: 'Steve Carell' }] } });
    cb(new Error('unexpected ' + url));
  };
  const md = MM.create({ credential: 'a'.repeat(32), read });
  const look = (q) => new Promise((res) => md.lookup(Object.assign({ kind: 'tv', language: 'en' }, q), (e, r) => res(e || r)));
  let r = await look({ guide: 'weak', title: 'The Office' });
  ok('the best known show of exactly that name (not a longer one)', r.metadata && r.metadata.id === 'tmdb:tv:22' && r.metadata.network === 'NBC' && r.metadata.year === '2005', JSON.stringify(r).slice(0, 200));
  r = await look({ guide: 'strong', title: 'The Office', year: '2001' });
  ok('the one that started in the year given, when one did', r.metadata && r.metadata.id === 'tmdb:tv:11' && r.metadata.network === 'BBC Two');
  r = await look({ guide: 'weak', title: 'Obscure' });
  ok('a weak guess at an obscure show is a miss', r.miss === true, JSON.stringify(r));
  r = await look({ guide: 'weak', title: 'Ax Men' });
  ok('a weak guess at a show a few people know (a cable reality show, 12 votes) is a match', r.metadata && r.metadata.id === 'tmdb:tv:55', JSON.stringify(r).slice(0, 120));
  r = await look({ guide: 'weak', title: 'Modern Marvels: Ink' });
  ok('no show of the whole name: the part before the colon ("Modern Marvels: Ink")', r.metadata && r.metadata.id === 'tmdb:tv:66', JSON.stringify(r).slice(0, 120));
  r = await look({ guide: 'weak', title: 'Hannah Montana Forever' });
  ok('no show of the whole name: the name without its last word, a show people know ("Hannah Montana Forever")', r.metadata && r.metadata.id === 'tmdb:tv:77', JSON.stringify(r).slice(0, 120));
  r = await look({ guide: 'weak', title: 'Big Bang Theory' });
  const r2 = await look({ guide: 'weak', title: 'Rubble and Crew' });
  ok('"The" in front and "&" for "and" make no difference', r.metadata && r.metadata.id === 'tmdb:tv:81' && r2.metadata && r2.metadata.id === 'tmdb:tv:82', JSON.stringify([r, r2]).slice(0, 200));
  r = await look({ guide: 'strong', title: 'Tiny Show Extra' });
  ok('but not a shorter name only a few people know', r.miss === true, JSON.stringify(r).slice(0, 120));
  const n1 = asked.length;
  r = await look({ guide: 'weak', title: 'Night of the Living' });
  ok('never cut down to a name ending on "the" or "of", or to one word', r.miss === true && asked.slice(n1).every((u) => !/query=(Night|Night%20of%20the|Night%20of)&/.test(u)), asked.slice(n1).join(' '));
  r = await look({ guide: 'strong', title: 'Obscure' });
  ok('a strong one (the guide gave an episode) takes it', !!(r.metadata || r instanceof Error) && !r.miss, JSON.stringify(r).slice(0, 120));
  const n0 = asked.length;
  r = await look({ guide: 'strong', title: 'Друзья' });
  ok('a name in another script is never matched to whatever comes first', r.miss === true && asked.length === n0, JSON.stringify(r));
  r = await look({ guide: 'weak', title: 'Ojciec Mateusz 2' });
  ok('a season number after the name (a Polish guide\'s "Ojciec Mateusz 2"): the show without it', r.metadata && r.metadata.id === 'tmdb:tv:83', JSON.stringify(r).slice(0, 120));
  const n2 = asked.length;
  r = await look({ guide: 'weak', title: 'Teen Mom 2' });
  ok('but a show whose name ends in a number is itself ("Teen Mom 2"), asked once', r.metadata && r.metadata.id === 'tmdb:tv:84' && asked.slice(n2).filter((u) => /search/.test(u)).length === 1, asked.slice(n2).join(' '));
  const n3 = asked.length;
  r = await look({ guide: 'weak', title: 'Blue 3' });
  ok('never cut down to a short single word ("Blue 3" is not "Blue")', r.miss === true && asked.slice(n3).every((u) => !/query=Blue&/.test(u)), asked.slice(n3).join(' '));
  r = await look({ guide: 'weak', title: 'Przyjaciele 8' });
  ok('and only a show of exactly that name ("Przyjaciele" is not "Friends" to an English TMDB)', r.miss === true, JSON.stringify(r).slice(0, 120));
  // ---- checked with real lookups against a real guide ----
  const id = (x) => x && x.metadata && x.metadata.id;
  r = await look({ guide: 'weak', title: 'Second Chance Pets' });
  ok('words are only cut off the end when guides add them ("Second Chance Pets" is not "Second Chance")', r.miss === true, JSON.stringify(r).slice(0, 120));
  r = await look({ guide: 'strong', title: 'Deal or No Deal Australia' });
  ok('a country at the end is that country\'s show ("Deal or No Deal Australia")', id(r) === 'tmdb:tv:99', JSON.stringify(r).slice(0, 120));
  const tam = await look({ guide: 'weak', title: 'Tamron Hall' }), pay = await look({ guide: 'weak', title: 'House Of Payne' });
  ok('TMDB\'s "The ... Show" and an owner in front match ("The Tamron Hall Show", "Tyler Perry\'s House of Payne")', id(tam) === 'tmdb:tv:90' && id(pay) === 'tmdb:tv:91', JSON.stringify([tam, pay]).slice(0, 200));
  r = await look({ guide: 'weak', title: 'Looney Tunes' });
  ok('but not when a show of exactly the name exists ("Looney Tunes" is not "The Looney Tunes Show")', r.miss === true, JSON.stringify(r).slice(0, 120));
  r = await look({ guide: 'weak', title: 'The Great American Journey' });
  ok('a show of exactly the name that few know is a miss, not a shorter name ("The Great")', r.miss === true, JSON.stringify(r).slice(0, 120));
  const us = await look({ guide: 'weak', title: 'Cheaters', country: 'US' }), any = await look({ guide: 'weak', title: 'Cheaters' });
  ok('of two shows of one name, the channel\'s country\'s', id(us) === 'tmdb:tv:96' && id(any) === 'tmdb:tv:95', JSON.stringify([us, any]).slice(0, 200));
  r = await look({ guide: 'weak', title: 'War', country: 'US' });
  ok('spelled the same comes first ("War" is WAR, not "The War", whatever the country)', id(r) === 'tmdb:tv:102', JSON.stringify(r).slice(0, 120));
  ok('only the name went to TMDB (no logins, no links)', asked.every((u) => /^https:\/\/api\.themoviedb\.org\/3\/(search\/tv|tv\/\d+)\?/.test(u)), asked.join(' '));

  // ---- the app: Series ----
  const ctx = { console, Date, Math, JSON, Object, Array, String, RegExp, Promise, setTimeout, clearTimeout, Error };
  const store = {};
  ctx.Store = { settings: {}, bigGet: () => Promise.resolve(null), bigSet: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); } };
  ctx.MediaStore = { tmdbToken: () => 'tok' };
  const asks = [];
  ctx.Media = {
    tvByName: (t, y, st) => { asks.push('show:' + t + '|' + y + '|' + st); return Promise.resolve(t === 'Severance' ? { metadata: { id: 'tmdb:tv:95396', title: 'Severance', year: '2022', poster: 'p.jpg', plot: 'Work and life.', genre: 'Drama', rating: '8.4', network: 'Apple TV+' } } : { miss: true }); },
    tvSeason: (id, s) => { asks.push('season:' + id + ':' + s); return Promise.resolve({ metadata: { episodes: [{ number: 1, title: 'Good News About Hell', plot: 'Mark is promoted.', still: 's1.jpg', airDate: '2022-02-18' }] } }); }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/series.js'), 'utf8') + ';this.Series = Series;', ctx);
  const S = ctx.Series, wait = (ms) => new Promise((res) => setTimeout(res, ms));
  ok('names cleaned of what providers put around them', S.clean('EN - Breaking Bad (2008) [4K]').t === 'Breaking Bad' && S.clean('EN - Breaking Bad (2008)').y === '2008' && S.clean('|US| The Office').t === 'The Office' && S.clean('CSI: Miami').t === 'CSI: Miami' && S.clean('Slow Horses S03').t === 'Slow Horses');
  ok('news shows without "news" in the name (Good Morning America, CBS Saturday Morning, Today) are not looked up, other shows are', ['Good Morning America', 'CBS Saturday Morning', 'Today', 'Nightline', '20/20'].every((t) => S.strength({ n: 'x' }, { t, s: 0, e: 3600e3 }) === '') && S.strength({ n: 'x' }, { t: 'Today\'s Homeowner', s: 0, e: 1800e3 }) === 'weak' && S.strength({ n: 'x' }, { t: 'Entertainment Tonight', s: 0, e: 1800e3 }) === 'weak');
  ok('news is left alone even when the guide numbers its episodes', S.strength({ n: 'x' }, { t: 'NBC Nightly News With Tom Llamas', ep: 'S5 E210', s: 0, e: 1800e3 }) === '' && S.strength({ n: 'x' }, { t: 'Hannah Montana Forever', ep: 'S4 E7', s: 0, e: 1800e3 }) === 'strong');
  ok('a season or episode inside the name comes off, with what follows it', ['Deal or No Deal Australia Season 12 (Reboot Season 01)', 'Brave Wilderness S2E2 -Face-to-Face with Cheetahs', 'Shark Tank :Season 4 :2026: Ep   4', 'Chasing Speed: Episode 1', 'Bronx Buds : Season 3'].map((t) => S.clean(t).t).join('|') === 'Deal or No Deal Australia|Brave Wilderness|Shark Tank|Chasing Speed|Bronx Buds',
    ['Deal or No Deal Australia Season 12 (Reboot Season 01)', 'Brave Wilderness S2E2 -Face-to-Face with Cheetahs', 'Shark Tank :Season 4 :2026: Ep   4', 'Chasing Speed: Episode 1', 'Bronx Buds : Season 3'].map((t) => S.clean(t).t).join('|'));
  ok('and makes it a sure ask, like a guide that gave the episode', S.strength({ n: 'x' }, { t: 'Shark Tank :Season 4 :2026: Ep   4', s: 0, e: 3600e3 }) === 'strong' && S.strength({ n: 'x' }, { t: 'Shark Tank', s: 0, e: 3600e3 }) === 'weak' && S.clean('Epic Meal Time').t === 'Epic Meal Time');
  ok('what guides tack on the end comes off too', S.clean('The UnXplained Special Presentation').t === 'The UnXplained' && S.clean('Ax Men Marathon').t === 'Ax Men' && S.clean('American Pickers (Encore)').t === 'American Pickers' && S.clean('Counting Cars - Season Finale').t === 'Counting Cars' && S.clean('Special Victims Unit').t === 'Special Victims Unit',
    [S.clean('The UnXplained Special Presentation').t, S.clean('Ax Men Marathon').t, S.clean('American Pickers (Encore)').t, S.clean('Counting Cars - Season Finale').t].join(' | '));
  const c = { n: 'Drama One', k: 'x1' }, now = Date.now();
  ok('with an episode from the guide it is surely a series', S.strength(c, { t: 'Severance', s: now, e: now + 3600e3, ep: 'S1 E1' }) === 'strong');
  ok('news, sport, a movie, a long programme and the channel\'s own name are not', ['n', 's'].every((k) => S.strength(c, { t: 'X', s: now, e: now + 1800e3, k: k }) === '') && S.strength(c, { t: 'X', s: now, e: now + 1800e3, mv: 1 }) === '' &&
    S.strength(c, { t: 'Big Thing', s: now, e: now + 3 * 3600e3 }) === '' && S.strength(c, { t: 'Drama One', s: now, e: now + 1800e3 }) === '' && S.strength(c, { t: 'Live at Five', s: now, e: now + 1800e3 }) === '');
  // From a real guide's titles: "Live" in a name can be a show; sport and placeholders are not.
  const st = (t, mins) => S.strength(c, { t: t, s: now, e: now + (mins || 60) * 60000 });
  ok('shows with "Live" in the name are looked up', ['Jimmy Kimmel Live!', 'Saturday Night Live', 'Live with Kelly and Mark', 'TMZ Live', 'The Walking Dead: The Ones Who Live'].every((t) => st(t) === 'weak'),
    ['Jimmy Kimmel Live!', 'Saturday Night Live', 'Live with Kelly and Mark', 'TMZ Live'].map((t) => t + '=' + st(t)).join(' '));
  ok('broadcasts, sport, team-channel listings and placeholders are not', ['Live: College Football', 'College Football', 'College Football : BYU at Utah', 'NWSL Soccer', 'Next game: Detroit Lions at Miami Dolphins at 11/08/2026 01:00 PM EST', 'Movie', 'Live!', 'News 12 Long Island'].every((t) => st(t) === ''),
    ['Live: College Football', 'College Football', 'NWSL Soccer', 'Next game: X', 'Movie', 'Live!'].map((t) => t + '=' + st(t)).join(' '));
  ok('": Season 3" comes off the name', S.clean('Bronx Buds : Season 3').t === 'Bronx Buds', S.clean('Bronx Buds : Season 3').t);
  ok('nothing known yet: null (what was kept is still being read)', S.of(c, { t: 'Severance', s: now, e: now + 3600e3, ep: 'S1 E1' }) === null);
  await wait(30);
  ok('once it is read: still null, and now it asks', S.of(c, { t: 'Severance', s: now, e: now + 3600e3, ep: 'S1 E1' }) === null);
  await wait(50);
  const sh = S.of(c, { t: 'Severance', s: now, e: now + 3600e3, ep: 'S1 E1' });
  ok('then the show: network, year, rating', sh && sh.network === 'Apple TV+' && sh.year === '2022' && sh.rating === '8.4', JSON.stringify(sh));
  ok('an episode not known yet: null, and its season is asked for once', S.episode(sh, 'S1 E1') === null && S.episode(sh, 'S1 E1') === null);
  await wait(400);
  const ep = S.episode(sh, 'S1 E1');
  ok('then its title, summary, picture and air date', ep && ep.t === 'Good News About Hell' && ep.still === 's1.jpg' && ep.air === '2022-02-18', JSON.stringify(ep));
  ok('one ask for the show, one for the season', asks.filter((a) => /^show:Severance/.test(a)).length === 1 && asks.filter((a) => /^season:/.test(a)).length === 1, asks.join(' '));
  // Scrolling past many: only the newest few are asked about.
  asks.length = 0;
  for (let i = 0; i < 20; i++) S.show('Show ' + i, '', 'weak');
  await wait(9000);
  ok('scrolling past twenty shows asks about the last ones only (the one you stopped on first)', asks.length <= 6 && asks[0] === 'show:Show 0||weak' && asks.slice(1).every((a) => /Show 1[6-9]/.test(a)), asks.join(' '));
  ok('a weak miss is asked again only when a strong reason comes', (() => { const n = asks.length; S.show('Show 19', '', 'weak'); const a = asks.length === n; S.show('Show 19', '', 'strong'); return a; })());
  await wait(400);
  ok('the answers are kept (misses too)', await wait(5200).then(() => store.tvseries && store.tvseries.shows && Object.keys(store.tvseries.shows).length >= 4 && Object.keys(store.tvseries.seasons).length === 1), JSON.stringify(Object.keys((store.tvseries || {}).shows || {})));
  ctx.Store.settings.guideSeries = false;
  ok('nor asked about by the app, where all of them would share one answer', S.show('مسلسل', '', 'strong') === null && S.show('Друзья', '', 'strong') === null);
  ok('Series details off: nothing', S.of(c, { t: 'Severance', s: now, e: now + 3600e3, ep: 'S1 E1' }) === null);
  // ---- issue: one more pass over a real guide's 20,000 titles ----
  {
    const cl = (t) => S.clean(t).t;
    ok('a show\'s own short name in front is not a country ("JAG - ...", "ER - ...")', cl('JAG - Wojskowe Biuro Śledcze') === 'JAG - Wojskowe Biuro Śledcze' && cl('ER - Love\'s Labor Lost') === 'ER - Love\'s Labor Lost' && cl('EN - Breaking Bad') === 'Breaking Bad' && cl('US - The Office') === 'The Office' && cl('IT: Welcome to Derry') === 'IT: Welcome to Derry', [cl('JAG - Wojskowe Biuro Śledcze'), cl('IT: Welcome to Derry')].join(' | '));
    ok('dubbed and subtitled copies are the show ("Naruto (English Dubbed)", "(English Dub)", "(ENG)", "(US)")', cl('Naruto (English Dubbed)') === 'Naruto' && cl('Inuyasha  (English Dubbed)') === 'Inuyasha' && cl('Yu-Gi-Oh! Zexal (English Dub)') === 'Yu-Gi-Oh! Zexal' && cl('Acapulco Shore (ENG)') === 'Acapulco Shore' && cl('Four Weddings (US)') === 'Four Weddings');
    ok('a title read with the wrong character set is mended ("Worldâs")', cl('World\u00e2\u0080\u0099s Funniest Videos') === 'World\u2019s Funniest Videos' && cl('Caf\u00c3\u00a9 Society') === 'Caf\u00e9 Society' && cl('Café Society') === 'Café Society', cl('World\u00e2\u0080\u0099s Funniest Videos'));
    const st = (t, min, ch) => S.strength(ch || { n: 'x' }, { t, s: now, e: now + min * 60000 });
    ok('not series: boxing bouts, local news, sport in other words', ['Benn vs. Dobson (2024)', 'Canelo vs. Mbilli (2026)', 'NEWS4 AT 11P', 'TVA nouvelles', 'Good Morning Augusta', 'College Countdown', 'Premier League Goal Zone', 'W rytmie dnia - serwis informacyjny', 'Piłka nożna: PKO BP Ekstraklasa'].every((t) => st(t, 30) === ''),
      ['Benn vs. Dobson (2024)', 'NEWS4 AT 11P', 'TVA nouvelles', 'Good Morning Augusta', 'College Countdown'].map((t) => t + ':' + st(t, 30)).join(' '));
    ok('but shows with those words are ("Man vs. Wild", "World\'s Funniest Videos Top 10 Countdown", "Jack Hanna\'s Wild Countdown")', ['Man vs. Wild', 'World\'s Funniest Videos Top 10 Countdown', 'Jack Hanna\'s Wild Countdown'].every((t) => st(t, 30) === 'weak'));
    const lst = [];
    for (let i = 0; i < 6; i++) lst.push({ t: 'Midsomer Murders', s: now + i * 7200e3, e: now + i * 7200e3 + 110 * 60000, d: 'Barnaby investigates case number ' + i + ' in the village.' });
    for (let i = 0; i < 4; i++) lst.push({ t: 'Elli and Her Monster Team', s: now + i * 9000e3, e: now + i * 9000e3 + 90 * 60000, d: 'A little ghost moves into a ghost train.' });
    ctx.Epg = { request: () => lst };
    const ch = { n: 'Drama Channel' };
    ok('a series in long slots (the channel tells a different story each time) is looked up', st('Midsomer Murders', 110, ch) === 'weak' && st('Midsomer Murders', 110, { n: 'other' }) === 'weak');
    ok('a long programme with the same story every time is a movie, not looked up', st('Elli and Her Monster Team', 90, ch) === '');
    delete ctx.Epg;
    ok('without the channel\'s guide, a long programme is still taken for a movie', st('Midsomer Murders', 110, ch) === '');
  }
  // Kept from an older version, with stricter matching: its misses are asked again, what it found stays.
  {
    const now2 = Date.now(), ctx2 = Object.assign({}, ctx), asks2 = [];
    ctx2.Store = { settings: {}, bigGet: () => Promise.resolve({ shows: { 'axmen|': { at: now2, s: 'weak', m: 0 }, 'severance|': { at: now2, s: 'strong', m: { id: 'tmdb:tv:95396', title: 'Severance' } } }, seasons: {} }), bigSet: () => {} };
    ctx2.Media = { tvByName: (t) => { asks2.push(t); return Promise.resolve({ miss: true }); }, tvSeason: () => Promise.resolve({ metadata: { episodes: [] } }) };
    vm.createContext(ctx2);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../app/js/series.js'), 'utf8') + ';this.Series = Series;', ctx2);
    ctx2.Series.show('Severance'); await wait(30);
    const sev = ctx2.Series.show('Severance'), ax = ctx2.Series.show('Ax Men'); await wait(60);
    ok('an older miss is asked again with today\'s matching; an older match is kept', !!sev && sev.title === 'Severance' && ax === null && asks2.indexOf('Ax Men') >= 0 && asks2.indexOf('Severance') < 0, JSON.stringify({ sev, asks2 }));
  }
  console.log(fails ? fails + ' FAILED' : 'all TMDB series checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
