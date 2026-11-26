/* Streaming Top 10s for the Movies and Shows homes, from FlixPatrol, for every TiviBro (discussion #184).

   GET /v1/top10?country=US
     -> { ok, country, date, charts: [{ service, movies: [{ r, t, tmdb }], shows: [...], all: [...] }] }
   r: the place (1 is the top), t: the title, tmdb: TMDB's id when FlixPatrol knows it.  movies / shows are a
   service's own charts for each; all is a service's one chart (Prime Video, Max ...), movies and shows together,
   each marked k: 'movie' | 'tv' when FlixPatrol says which.

   The key (FlixPatrol's API key, the secret FLIXPATROL_KEY) is only ever sent to api.flixpatrol.com.  The plan
   allows 1,000 calls a month, so no TV ever causes one directly: a country's charts are kept in KV (TOP10) and
   asked for again at most once a day, one call per country (FlixPatrol's own quota check is free and says how
   many are left).  When the month's calls run low, every country is served what it had for longer, and a
   country never asked about before waits until there are calls to spare.  Nothing about who asked is stored. */

const API = 'https://api.flixpatrol.com/v2';
// The services shown, by FlixPatrol's company id (api docs: Most common objects IDs).  The name is what the TV shows.
export const SERVICES = {
  cmp_IA6TdMqwf6kuyQvxo9bJ4nKX: 'Netflix', cmp_qypvowjqFhEIpCc0HlQ6VoYk: 'Prime Video', cmp_oGtsgdpOrjIu3XzTEnWPt87Y: 'Disney+',
  cmp_6UhCvnTeRkgZUtcNGslX9bJL: 'HBO Max', cmp_Y3HB13ahfd2y6npIiMrwcvRj: 'Max', cmp_VvmYc7OphiUds0Hgjbz5MESn: 'Apple TV',
  cmp_9iwHIMYOCvD6zprSPoHgTJau: 'Hulu', cmp_riMmDaNhomIc4J2dWGQPKbkZ: 'Paramount+', cmp_5xU3J3E4UMZoCD62pGqLKjO8: 'Peacock',
  cmp_lFEK5MFWy70b9iCcftZKaDEw: 'JioHotstar', cmp_oUUegdpOrjIu3XzTEnWPt87Y: 'Hotstar'
};
// FlixPatrol's ids for the countries (two letters, from its API docs); others are answered with nothing.
export const COUNTRIES = {
  AD: 'cnt_Di79cvFOpmwE3Zhn1SozXJN6', AE: 'cnt_keJpFHRGi3CIYLPg7FTEJ9XK', AF: 'cnt_RKhbGi0mzOncND8jVoZ2HSTv',
  AG: 'cnt_Gn2FyVoYqxjfPUJzt21NZ6yg', AL: 'cnt_frtSsnlNXyvuVZT8gBAweRjQ', AM: 'cnt_OJZhZJ6SLvjiIlkfh4YKEtTy',
  AO: 'cnt_RKjbGi0mzOncND8jVoZ2HSTv', AR: 'cnt_keVRFHRGi3CIYLPg7FTEJ9XK', AT: 'cnt_gGE4RaeXpyz2U9Q5tEMYDwri',
  AU: 'cnt_oKTgdpOrjIu3XzTEnWPt87YV', AW: 'cnt_qRAKowjqFhEIpCc0HlQ6VoYk', AZ: 'cnt_Y8uC13ahfd2y6npIiMrwcvRj',
  BA: 'cnt_Cw6T89vcTOtjqMu0ng6w2QIf', BB: 'cnt_JxY47ZCyHJKz3fYOrtq6En4s', BD: 'cnt_SDTa2GEw54ahWxJsXNgBMmt0',
  BE: 'cnt_VhRwc7OphiUds0Hgjbz5MESn', BF: 'cnt_s12Xd4qGr0ytVxTuORBZ1KgP', BG: 'cnt_8z1W3PlONbeWiHX60xVfZLm4',
  BH: 'cnt_pcKGns8OP1rtHnX6QwlEKhiq', BI: 'cnt_kWJKFHRGi3CIYLPg7FTEJ9XK', BJ: 'cnt_cl2iOjICD0BkFTWeZEXR41y5',
  BN: 'cnt_9Nr1IMYOCvD6zprSPoHgTJau', BO: 'cnt_za3Jf1J4mByugefajiwQFDxL', BR: 'cnt_Yze13ahfd2y6npIiMrwcvRj4',
  BS: 'cnt_5xvDJ3E4UMZoCD62pGqLKjO8', BT: 'cnt_mRLPAI3Ec9j15zKG0bNkSspd', BW: 'cnt_BcZ8pjUaQxLHk84AY3ldN2X0',
  BY: 'cnt_KnGABes9dtvkV710raDBpXoK', BZ: 'cnt_CfHf89vcTOtjqMu0ng6w2QIf', CA: 'cnt_RpYbGi0mzOncND8jVoZ2HSTv',
  CD: 'cnt_a9f30RJTnt9XO4bVmoriU3Ih', CF: 'cnt_vkOGlVlz6xabS78vHh0DCIc5', CG: 'cnt_bB3GTvopBHPVtIKhR2CF68WD',
  CH: 'cnt_IizcTdMqwf6kuyQvxo9bJ4nK', CI: 'cnt_bK5PGTvopBHPVtIKhR2CF68W', CL: 'cnt_nOBIV46scBZ5bMKzLHDR3P2m',
  CM: 'cnt_8S6Z3PlONbeWiHX60xVfZLm4', CN: 'cnt_UpojK0k2lQEVcb5uWXZtGhTg', CO: 'cnt_qRNBowjqFhEIpCc0HlQ6VoYk',
  CR: 'cnt_KnUdBes9dtvkV710raDBpXoK', CU: 'cnt_DtA29cvFOpmwE3Zhn1SozXJN', CV: 'cnt_qUUVowjqFhEIpCc0HlQ6VoYk',
  CY: 'cnt_SPzSa2GEw54ahWxJsXNgBMmt', CZ: 'cnt_Vhic7OphiUds0Hgjbz5MESnX', DE: 'cnt_Ag8qt1ZYhro5JK83F6AzcwWH',
  DJ: 'cnt_j8NTQOZdFfkmptwNlD93rPg4', DK: 'cnt_3fsuwxqThDY1lMmVReiwEBoW', DM: 'cnt_tLLgiZWTog2beK9rmPdNBpx6',
  DO: 'cnt_Kc8Bes9dtvkV710raDBpXoKR', DZ: 'cnt_ARcrqt1ZYhro5JK83F6AzcwW', EC: 'cnt_UpGiK0k2lQEVcb5uWXZtGhTg',
  EE: 'cnt_vJOUlVlz6xabS78vHh0DCIc5', EG: 'cnt_72pk4wZBnc8VylGpH5aTR6Mm', ER: 'cnt_gUqoRaeXpyz2U9Q5tEMYDwri',
  ES: 'cnt_JFT7ZCyHJKz3fYOrtq6En4sV', ET: 'cnt_GKRoyVoYqxjfPUJzt21NZ6yg', FI: 'cnt_zDsf1J4mByugefajiwQFDxLr',
  FJ: 'cnt_BcjOpjUaQxLHk84AY3ldN2X0', FM: 'cnt_TEpKtm4EANJkiftU2bpG5gLo', FR: 'cnt_bUCGTvopBHPVtIKhR2CF68WD',
  GA: 'cnt_DiPp9cvFOpmwE3Zhn1SozXJN', GB: 'cnt_cvaOjICD0BkFTWeZEXR41y5q', GD: 'cnt_GVVJyVoYqxjfPUJzt21NZ6yg',
  GE: 'cnt_rIatDaNhomIc4J2dWGQPKbkZ', GH: 'cnt_YCjO13ahfd2y6npIiMrwcvRj', GL: 'cnt_p5jxns8OP1rtHnX6QwlEKhiq',
  GM: 'cnt_SDzza2GEw54ahWxJsXNgBMmt', GN: 'cnt_ve5lVlz6xabS78vHh0DCIc5e', GQ: 'cnt_9iK4IMYOCvD6zprSPoHgTJau',
  GR: 'cnt_NEt8ueMUHlNqj02pZEBFyWIh', GT: 'cnt_NX0ueMUHlNqj02pZEBFyWIhu', GW: 'cnt_JelS7ZCyHJKz3fYOrtq6En4s',
  GY: 'cnt_bBgwGTvopBHPVtIKhR2CF68W', HK: 'cnt_JFp87ZCyHJKz3fYOrtq6En4s', HN: 'cnt_dYsNjTwWIyEFksrU1KGRlp9C',
  HR: 'cnt_vJcylVlz6xabS78vHh0DCIc5', HT: 'cnt_5FQgJ3E4UMZoCD62pGqLKjO8', HU: 'cnt_O5ehZJ6SLvjiIlkfh4YKEtTy',
  ID: 'cnt_0DSsPdHCr46KGEgNvXYhsT1y', IE: 'cnt_9twsIMYOCvD6zprSPoHgTJau', IL: 'cnt_ar1Y0RJTnt9XO4bVmoriU3Ih',
  IN: 'cnt_KnbmBes9dtvkV710raDBpXoK', IQ: 'cnt_RygebGi0mzOncND8jVoZ2HST', IR: 'cnt_j122QOZdFfkmptwNlD93rPg4',
  IS: 'cnt_18jJ6JRSK93ou4PTnsdDhGjc', IT: 'cnt_UpfK0k2lQEVcb5uWXZtGhTgR', JM: 'cnt_KnyqBes9dtvkV710raDBpXoK',
  JO: 'cnt_Olc5hZJ6SLvjiIlkfh4YKEtT', JP: 'cnt_yB4vU2UzROTNVv5JZ7Hu4m8M', KE: 'cnt_phcns8OP1rtHnX6QwlEKhiqU',
  KG: 'cnt_ynmhU2UzROTNVv5JZ7Hu4m8M', KH: 'cnt_obq7gdpOrjIu3XzTEnWPt87Y', KI: 'cnt_i4mhNbZvnNHK5YdhgwtOoP4u',
  KM: 'cnt_ycOsU2UzROTNVv5JZ7Hu4m8M', KN: 'cnt_wrruzrGHymbFBgUf1eq82ivW', KP: 'cnt_NmDueMUHlNqj02pZEBFyWIhu',
  KR: 'cnt_RyEvbGi0mzOncND8jVoZ2HST', KW: 'cnt_RygKbGi0mzOncND8jVoZ2HST', KY: 'cnt_wDmzrGHymbFBgUf1eq82ivWo',
  KZ: 'cnt_RUs1bGi0mzOncND8jVoZ2HST', LA: 'cnt_yBGeU2UzROTNVv5JZ7Hu4m8M', LB: 'cnt_18Q76JRSK93ou4PTnsdDhGjc',
  LC: 'cnt_3PrGwxqThDY1lMmVReiwEBoW', LI: 'cnt_bK8GTvopBHPVtIKhR2CF68WD', LK: 'cnt_nvXV46scBZ5bMKzLHDR3P2mf',
  LR: 'cnt_uLOBMo9k8rSnwEmcX71yBFCj', LS: 'cnt_RpnsbGi0mzOncND8jVoZ2HST', LT: 'cnt_obAzgdpOrjIu3XzTEnWPt87Y',
  LU: 'cnt_0DfHPdHCr46KGEgNvXYhsT1y', LV: 'cnt_uXtDMo9k8rSnwEmcX71yBFCj', LY: 'cnt_iX0oNbZvnNHK5YdhgwtOoP4u',
  MA: 'cnt_3f8qwxqThDY1lMmVReiwEBoW', MC: 'cnt_Q3RjYlqXcCWTfRiH0Zgy9ur1', MD: 'cnt_w0hZzrGHymbFBgUf1eq82ivW',
  ME: 'cnt_l7hj5MFWy70b9iCcftZKaDEw', MG: 'cnt_TM9Dtm4EANJkiftU2bpG5gLo', MH: 'cnt_Khv6Bes9dtvkV710raDBpXoK',
  MK: 'cnt_gy0RaeXpyz2U9Q5tEMYDwrin', ML: 'cnt_UVGYK0k2lQEVcb5uWXZtGhTg', MM: 'cnt_F2OWx2P39fsIlph6zrCydxTG',
  MN: 'cnt_hJqviqeVKo92c5gQOChBLPAH', MQ: 'cnt_QzfGYlqXcCWTfRiH0Zgy9ur1', MR: 'cnt_IN2TdMqwf6kuyQvxo9bJ4nKX',
  MT: 'cnt_wS3TzrGHymbFBgUf1eq82ivW', MU: 'cnt_KcqkBes9dtvkV710raDBpXoK', MV: 'cnt_aIRA0RJTnt9XO4bVmoriU3Ih',
  MW: 'cnt_d1tVjTwWIyEFksrU1KGRlp9C', MX: 'cnt_Cw2S89vcTOtjqMu0ng6w2QIf', MY: 'cnt_bUgfGTvopBHPVtIKhR2CF68W',
  MZ: 'cnt_jC8QOZdFfkmptwNlD93rPg4v', NA: 'cnt_moXrAI3Ec9j15zKG0bNkSspd', NE: 'cnt_c5n6OjICD0BkFTWeZEXR41y5',
  NG: 'cnt_CfX89vcTOtjqMu0ng6w2QIfD', NI: 'cnt_z0Wf1J4mByugefajiwQFDxLr', NL: 'cnt_GK4KyVoYqxjfPUJzt21NZ6yg',
  NO: 'cnt_cvbdOjICD0BkFTWeZEXR41y5', NP: 'cnt_1326JRSK93ou4PTnsdDhGjcx', NR: 'cnt_d83LjTwWIyEFksrU1KGRlp9C',
  NZ: 'cnt_OlGphZJ6SLvjiIlkfh4YKEtT', OM: 'cnt_arfz0RJTnt9XO4bVmoriU3Ih', PA: 'cnt_oGWgdpOrjIu3XzTEnWPt87YV',
  PE: 'cnt_pcUbns8OP1rtHnX6QwlEKhiq', PG: 'cnt_BODLpjUaQxLHk84AY3ldN2X0', PH: 'cnt_8083PlONbeWiHX60xVfZLm4I',
  PK: 'cnt_Vhprc7OphiUds0Hgjbz5MESn', PL: 'cnt_KnyBes9dtvkV710raDBpXoKR', PR: 'cnt_uXi9Mo9k8rSnwEmcX71yBFCj',
  PS: 'cnt_FZk6x2P39fsIlph6zrCydxTG', PT: 'cnt_moLDAI3Ec9j15zKG0bNkSspd', PW: 'cnt_S9goa2GEw54ahWxJsXNgBMmt',
  PY: 'cnt_l7vQ5MFWy70b9iCcftZKaDEw', QA: 'cnt_j1ssQOZdFfkmptwNlD93rPg4', RO: 'cnt_kecbFHRGi3CIYLPg7FTEJ9XK',
  RS: 'cnt_5kvIJ3E4UMZoCD62pGqLKjO8', RU: 'cnt_yBRmU2UzROTNVv5JZ7Hu4m8M', RW: 'cnt_rtmDaNhomIc4J2dWGQPKbkZB',
  SA: 'cnt_iMtpNbZvnNHK5YdhgwtOoP4u', SB: 'cnt_JW2T7ZCyHJKz3fYOrtq6En4s', SC: 'cnt_c7kaOjICD0BkFTWeZEXR41y5',
  SD: 'cnt_QCrOYlqXcCWTfRiH0Zgy9ur1', SE: 'cnt_bU4CGTvopBHPVtIKhR2CF68W', SG: 'cnt_GKmByVoYqxjfPUJzt21NZ6yg',
  SI: 'cnt_Ag4jqt1ZYhro5JK83F6AzcwW', SK: 'cnt_7eUk4wZBnc8VylGpH5aTR6Mm', SL: 'cnt_oKsgdpOrjIu3XzTEnWPt87YV',
  SM: 'cnt_GpRAyVoYqxjfPUJzt21NZ6yg', SN: 'cnt_AbEWqt1ZYhro5JK83F6AzcwW', SO: 'cnt_phKRns8OP1rtHnX6QwlEKhiq',
  SR: 'cnt_ynb4U2UzROTNVv5JZ7Hu4m8M', SS: 'cnt_u4irMo9k8rSnwEmcX71yBFCj', ST: 'cnt_5eG6J3E4UMZoCD62pGqLKjO8',
  SV: 'cnt_lFBx5MFWy70b9iCcftZKaDEw', SY: 'cnt_gKVRaeXpyz2U9Q5tEMYDwrin', SZ: 'cnt_rNNXDaNhomIc4J2dWGQPKbkZ',
  TD: 'cnt_RKXhbGi0mzOncND8jVoZ2HST', TG: 'cnt_KcymBes9dtvkV710raDBpXoK', TH: 'cnt_9MrIMYOCvD6zprSPoHgTJauB',
  TJ: 'cnt_4gtbmMWPSCaKxwn2tVzTXmcg', TL: 'cnt_oKBZgdpOrjIu3XzTEnWPt87Y', TM: 'cnt_QzpYlqXcCWTfRiH0Zgy9ur1G',
  TN: 'cnt_KVsFBes9dtvkV710raDBpXoK', TO: 'cnt_bnVCGTvopBHPVtIKhR2CF68W', TR: 'cnt_9trCIMYOCvD6zprSPoHgTJau',
  TT: 'cnt_pvQWns8OP1rtHnX6QwlEKhiq', TV: 'cnt_DuM59cvFOpmwE3Zhn1SozXJN', TW: 'cnt_UpRTK0k2lQEVcb5uWXZtGhTg',
  TZ: 'cnt_u4EMo9k8rSnwEmcX71yBFCjT', UA: 'cnt_h5cMviqeVKo92c5gQOChBLPA', UG: 'cnt_4g7mMWPSCaKxwn2tVzTXmcgQ',
  US: 'cnt_iMUHNbZvnNHK5YdhgwtOoP4u', UY: 'cnt_8z623PlONbeWiHX60xVfZLm4', UZ: 'cnt_qGuKowjqFhEIpCc0HlQ6VoYk',
  VA: 'cnt_QwzGYlqXcCWTfRiH0Zgy9ur1', VC: 'cnt_9u7UIMYOCvD6zprSPoHgTJau', VE: 'cnt_lFw5MFWy70b9iCcftZKaDEw1',
  VG: 'cnt_BlsKpjUaQxLHk84AY3ldN2X0', VN: 'cnt_9tP6IMYOCvD6zprSPoHgTJau', VU: 'cnt_UOhfK0k2lQEVcb5uWXZtGhTg',
  WS: 'cnt_zrVif1J4mByugefajiwQFDxL', XK: 'cnt_gKAYRaeXpyz2U9Q5tEMYDwri', YE: 'cnt_UnkTK0k2lQEVcb5uWXZtGhTg',
  ZA: 'cnt_YC713ahfd2y6npIiMrwcvRj4', ZM: 'cnt_bBgHGTvopBHPVtIKhR2CF68W', ZW: 'cnt_TMXtm4EANJkiftU2bpG5gLoV'
};
const DAY = 86400e3, KEEP_FOR = 30 * DAY;

/* How long a country's charts are kept before asking again: a day while calls are plentiful, longer as the
   month's run low (left: calls left, days: days until they come back). */
export function freshFor(left, days) {
  const perDay = left / Math.max(1, days);
  return perDay >= 20 ? DAY : perDay >= 8 ? 2 * DAY : perDay >= 3 ? 4 * DAY : Infinity;
}
function auth(env) { return { Authorization: 'Basic ' + btoa(env.FLIXPATROL_KEY + ':'), Accept: 'application/json' }; }
// FlixPatrol's own count of this month's calls (free): { left, days }.
async function quota(env) {
  const r = await fetch(API + '/quota', { headers: auth(env) });
  if (!r.ok) throw new Error('quota ' + r.status);
  const d = (await r.json()).data || {};
  return { left: +d.available || 0, days: Math.max(1, Math.ceil((Date.parse(d.resetAt + 'Z') - Date.now()) / DAY)) };
}
function day(t) { return new Date(t).toISOString().slice(0, 10); }
// One title's line: its place, its name and its TMDB id, and movie or show when the TMDB link says.
function row(x) {
  const m = (x.movie && x.movie.data) || {}, link = String(m.tmdbLink || '');
  const o = { r: +x.ranking || 0, t: String(m.title || x.note || '').slice(0, 200) };
  if (/^[1-9][0-9]{0,9}$/.test(String(m.tmdbId || ''))) o.tmdb = +m.tmdbId;
  if (/\/movie\//.test(link)) o.k = 'movie'; else if (/\/tv\//.test(link)) o.k = 'tv';
  return o;
}
/* Yesterday's charts for a country, as TiviBro shows them: one call for up to 300 lines (every service in
   SERVICES has at most 30 in a country a day). */
export async function ask(env, country, now) {
  const q = new URLSearchParams();
  q.set('country[eq]', COUNTRIES[country]);
  q.set('company[in]', Object.keys(SERVICES).join(','));
  q.set('type[in]', '1,2,3');
  q.set('date[type][eq]', '1');
  q.set('date[from][eq]', day(now - DAY));
  const r = await fetch(API + '/top10s?' + q.toString(), { headers: auth(env) });
  if (!r.ok) throw new Error('top10s ' + r.status);
  const by = {};
  ((await r.json()).data || []).forEach((w) => {
    const x = w && w.data, svc = x && x.company && x.company.data && SERVICES[x.company.data.id];
    if (!svc || !(x.ranking > 0)) return;
    const c = by[svc] || (by[svc] = { service: svc, movies: [], shows: [], all: [] });
    (x.type === 2 ? c.movies : x.type === 3 ? c.shows : x.type === 1 ? c.all : []).push(row(x));
  });
  const charts = Object.keys(by).map((k) => by[k]);
  charts.forEach((c) => ['movies', 'shows', 'all'].forEach((n) => c[n].sort((a, b) => a.r - b.r).splice(10)));
  return { country, date: day(now - DAY), at: now, charts };
}

/* The answer for a country: the charts kept, asked again when they're due and the month's calls allow.  A failed
   ask keeps what was there (and isn't tried again for an hour). */
export async function top10(env, country, ctx, now) {
  now = now || Date.now();
  country = String(country || '').toUpperCase();
  if (!COUNTRIES[country]) return { ok: true, country, date: '', charts: [] };
  const kept = await env.TOP10.get('c:' + country, 'json');
  const due = !kept || now - kept.at >= DAY;
  // lock: another place asked in the last 5 minutes (KV takes up to a minute to reach everywhere): leave it to them.
  const lock = due ? await env.TOP10.get('lock:' + country) : null;
  if (due && !lock && env.FLIXPATROL_KEY && !(kept && kept.failedAt && now - kept.failedAt < 3600e3)) {
    await env.TOP10.put('lock:' + country, '1', { expirationTtl: 300 });
    try {
      const q = await quota(env);
      if (!kept || now - kept.at >= freshFor(q.left, q.days)) {
        if (q.left > 0) {
          const fresh = await ask(env, country, now);
          // An empty answer (FlixPatrol hasn't got yesterday yet) keeps the older charts.
          if (fresh.charts.length || !kept) { ctx.waitUntil(env.TOP10.put('c:' + country, JSON.stringify(fresh), { expirationTtl: KEEP_FOR / 1000 })); return Object.assign({ ok: true }, out(fresh)); }
        }
      }
    } catch (e) {
      console.log('top10 error: ' + (e && e.message));
      if (kept) ctx.waitUntil(env.TOP10.put('c:' + country, JSON.stringify(Object.assign({}, kept, { failedAt: now })), { expirationTtl: KEEP_FOR / 1000 }));
    }
  }
  return Object.assign({ ok: true }, kept ? out(kept) : { country, date: '', charts: [] });
}
function out(k) { return { country: k.country, date: k.date, charts: k.charts }; }
