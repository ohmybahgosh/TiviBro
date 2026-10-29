/* Channel logo index for "Channel logos" on the TV, published with the website at tivibro.app/logos/.
   TiviBro hosts no logo images.  This index only lists where two open logo projects keep theirs:
     iptv-org/database   channel names, ids and logo addresses (public domain data, CC0)
                         https://github.com/iptv-org/database
     tv-logo/tv-logos    a matching set of logos for dark screens, one PNG per channel, by country
                         https://github.com/tv-logo/tv-logos
   The TV downloads the index for the countries in its playlist and loads each logo from its own
   project, the way it loads a provider's logos.
     node scripts/logos/build-index.js [outDir] [--from dir]
   --from reads channels.json, logos.json and tvlogos-tree.json from a folder instead of the web.
   Output: index.json (the countries, how many logos each, where the images live) and one <CC>.json per
   country: { e: [[key, iptv-org id, iptv-org logo, tv-logos path], ...], x: [[other name key, entry], ...] }.
   Keys are Tidy.logoKey() keys, the same the TV computes from channel names. */
'use strict';
const fs = require('fs'), path = require('path');
global.window = global;
eval(fs.readFileSync(path.join(__dirname, '../../app/js/names.js'), 'utf8') + ';global.Names=Names;');
const Tidy = require('../../app/js/tidy.js');

const args = process.argv.slice(2), fi = args.indexOf('--from'), FROM = fi >= 0 ? args[fi + 1] : '';
const OUT = args.filter((a, i) => a !== '--from' && args[i - 1] !== '--from')[0] || path.join(__dirname, '../../site/logos');
const SRC = {
  channels: 'https://iptv-org.github.io/api/channels.json',
  logos: 'https://iptv-org.github.io/api/logos.json',
  tree: 'https://api.github.com/repos/tv-logo/tv-logos/git/trees/main?recursive=1'
};
const TVLOGOS = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/';

async function get(name) {
  if (FROM) return JSON.parse(fs.readFileSync(path.join(FROM, name === 'tree' ? 'tvlogos-tree.json' : name + '.json'), 'utf8'));
  const h = { 'User-Agent': 'tivibro-logo-index' };
  if (name === 'tree' && process.env.GITHUB_TOKEN) h.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  const r = await fetch(SRC[name], { headers: h });
  if (!r.ok) throw new Error(SRC[name] + ': HTTP ' + r.status);
  return r.json();
}

// Country codes as TiviBro uses them (Tidy): UK not GB, regions for the tv-logos world folders.
const CC_FIX = { GB: 'UK', LAM: 'LAT', MEA: 'ARAB', AFR: 'AFRICA', ASI: 'ASIA', EU: 'EU', INT: 'INT' };
const cc = c => { c = String(c || '').toUpperCase(); return CC_FIX[c] || c; };
const key = name => Tidy.logoKey(name);

// tv-logos file names: "espn-2-us.png", "hbo-family-hz-us.png", "us-local/abc-7-kswo-us.png".
// Variants rank below the plain logo; light ones are for light backgrounds, so last.
const VARIANT = { hz: 1, alt: 1, icon: 2, flat: 1, color: 1, framed: 2, square: 2, stacked: 1, mono: 2, default: 0, white: 3, light: 4, dark: 3 };
function tvEntries(tree) {
  const out = [];
  tree.tree.forEach(x => {
    if (x.type !== 'blob' || !/^countries\/.+\.png$/i.test(x.path)) return;
    if (/\/(old|obsolete|screen-bug|horizontal)\//i.test(x.path)) return;
    const file = x.path.split('/').pop().replace(/\.png$/i, '');
    const m = /^(.+)-([a-z]{2,4})$/.exec(file); if (!m) return;
    let rank = 0;
    const toks = m[1].split('-').filter(t => {
      if (VARIANT[t] != null) { rank += VARIANT[t]; return false; }
      if (/^logo$/.test(t) || /^(19|20)\d\d$/.test(t)) { rank += 2; return false; }
      if (t === 'bug') { rank += 9; return false; }
      return true;
    });
    const k = key(toks.join(' ')); if (!k) return;
    const call = toks.filter(t => /^[kw][a-z]{2,3}$/.test(t))[0] || '';
    out.push({ cc: cc(m[2]), k, call, rank: rank + (x.path.split('/').length > 3 ? 0.5 : 0), path: x.path });
  });
  return out;
}

// iptv-org: the best logo per channel: in use, the channel's own (not a feed's), PNG, near 512 wide.
function bestLogos(logos) {
  const by = {};
  logos.forEach(l => {
    if (!l.url || l.in_use === false) return;
    const score = (l.feed ? 0 : 4) + (/png/i.test(l.format || '') ? 2 : /svg/i.test(l.format || '') ? 1 : 0) - Math.abs((l.width || 300) - 512) / 1000 - (/i\.imgur\.com/.test(l.url) ? 0 : 0.1);
    const cur = by[l.channel];
    if (!cur || score > cur.score) by[l.channel] = { url: l.url, score };
  });
  return by;
}

(async () => {
  const [channels, logos, tree] = await Promise.all([get('channels'), get('logos'), get('tree')]);
  const best = bestLogos(logos), countries = {};
  const C = c => countries[c] || (countries[c] = { e: [], byKey: {}, x: [], seen: {} });
  function entry(c, k) {
    const x = C(c);
    if (x.byKey[k] != null) return x.e[x.byKey[k]];
    const e = [k, '', '', '']; x.byKey[k] = x.e.length; x.e.push(e); return e;
  }
  let iptv = 0, tv = 0;
  channels.forEach(ch => {
    if (ch.closed || ch.is_nsfw) return;
    const l = best[ch.id]; if (!l) return;
    const c = cc(ch.country), k = key(ch.name); if (!k || k.length < 2) return;
    const e = entry(c, k);
    if (e[2]) return;                                         // two channels, one name: keep the first
    e[1] = ch.id; e[2] = l.url; iptv++;
    const idx = C(c).byKey[k];
    (ch.alt_names || []).forEach(a => { const ak = key(a); if (ak && ak.length > 1 && ak !== k && C(c).byKey[ak] == null && !C(c).seen[ak]) { C(c).seen[ak] = 1; C(c).x.push([ak, idx]); } });
    // US and Canadian stations: "WXYZ-TV" also answers to its call sign.
    const call = /^([KWCV][A-Z]{2,3})(?:-?(?:TV|DT|LD|CD|LP))?$/.exec(ch.name);
    if (call) { const ck = call[1].toLowerCase(); if (ck !== k && C(c).byKey[ck] == null && !C(c).seen[ck]) { C(c).seen[ck] = 1; C(c).x.push([ck, idx]); } }
  });
  const picked = {};
  tvEntries(tree).forEach(t => { const id = t.cc + '|' + t.k; if (!picked[id] || t.rank < picked[id].rank || (t.rank === picked[id].rank && t.path.length < picked[id].path.length)) picked[id] = t; });
  Object.keys(picked).forEach(id => {
    const t = picked[id], e = entry(t.cc, t.k);
    if (!e[3]) { e[3] = t.path.slice('countries/'.length); tv++; }
    if (t.call && t.call !== t.k) {
      const x = C(t.cc), ci = x.byKey[t.call];
      if (ci != null) { if (!x.e[ci][3]) x.e[ci][3] = e[3]; }           // iptv-org has the station under its call sign
      else if (!x.seen[t.call]) { x.seen[t.call] = 1; x.x.push([t.call, x.byKey[t.k]]); }
    }
  });

  fs.mkdirSync(OUT, { recursive: true });
  const index = { v: 1, at: new Date().toISOString().slice(0, 10), tvlogos: TVLOGOS + 'countries/', sources: ['https://github.com/iptv-org/database', 'https://github.com/tv-logo/tv-logos'], countries: {} };
  let bytes = 0;
  Object.keys(countries).sort().forEach(c => {
    const x = countries[c]; if (!x.e.length) return;
    const body = JSON.stringify({ v: 1, e: x.e, x: x.x });
    fs.writeFileSync(path.join(OUT, c + '.json'), body);
    bytes += body.length;
    index.countries[c] = x.e.length;
  });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  console.log('Logo index: ' + Object.keys(index.countries).length + ' countries, ' + iptv + ' from iptv-org, ' + tv + ' from tv-logos, ' + Math.round(bytes / 1024) + ' KB in ' + OUT);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
