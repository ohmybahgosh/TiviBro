#!/usr/bin/env node
/* Translates what's missing on tivibro.app into one language (or all) with Claude (the Anthropic API), checked
   like any import (scripts/site/i18n-site.js problem) and written to site/i18n/<code>.json.
     node scripts/site/i18n-site-fill.js de _site           one language, from the built site
     node scripts/site/i18n-site-fill.js all _site          every language
     node scripts/site/i18n-site-fill.js de _site --now     one request after another instead of a batch
   Build the site first (cp -r site/. _site && node scripts/site/build-pages.js _site).  The key comes from
   ANTHROPIC_API_KEY (never commit it); I18N_MODEL picks the model.  The rules go first as the system prompt,
   cached, so each request after the first reads them cheaply.  By default the requests go together through the
   Message Batches API (half price, usually done within minutes); --now asks them a few at a time.  A text that fails a check is asked once more on its
   own, told what was wrong, then left in English for a person. */
'use strict';
const S = require('./i18n-site.js'), { STYLE } = require('../i18n-lib.js');
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.I18N_MODEL || 'claude-sonnet-5-5';
const argv = process.argv.slice(2), NOW = argv.indexOf('--now') >= 0, [which, root] = argv.filter((a) => a !== '--now'), SIZE = 30, PARALLEL = 4;
const API = 'https://api.anthropic.com/v1', HEAD = { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' };
if (!KEY) { console.error('ANTHROPIC_API_KEY is not set.  Without it: i18n-site.js todo <code>, translate, i18n-site.js import <code> done.json'); process.exit(1); }

// The app speaks formally in these (app/js/lang), so the site does too.
const FORMAL = ['fr', 'ru', 'tr', 'uk', 'hi'];
const RULES = (lang) => [
  'You translate the website of TiviBro, a free IPTV player app for LG webOS TVs, from English into ' + lang.english + ' (' + lang.code + ').',
  'Each item is a piece of a web page, sometimes with HTML tags inside.  Keep every tag exactly as it is (same tags, same attributes, same order where the grammar allows), and translate only the words between them.  Never translate what is inside <code>.',
  'Keep these as they are: TiviBro, TiviMate, Plex, Plex Pass, webOS, LG, Magic Remote, Homebrew Channel, Developer Mode, Xtream Codes, M3U, XMLTV, Stalker, EPG, TMDB, TheTVDB, Trakt, IntroDB, TheIntroDB, OpenSubtitles, GitHub, Google Play, Android, APK, IPK, WebDAV, DLNA, SMB, NAS, HDR, Dolby Vision, Atmos, DTS, Multiview, product and company names, numbers, prices, addresses and file names.',
  'Plain, friendly words for TV viewers, addressing the reader the way the TiviBro app does: ' + (FORMAL.indexOf(lang.code) >= 0 ? 'the polite form (vous, вы, siz).' : 'the informal form (du, tú, tu, jij, ty, você).') + '  Never use an em dash.  Keep emoji and flags.',
  'Answer with one JSON object only: {"1": "translation", "2": "translation", ...}, a translation for every number.'
].concat(STYLE[lang.code] ? [STYLE[lang.code]] : []).join('\n');

// One request's body: the rules first, cached (for an hour in a batch, whose requests can start well apart).
function body(lang, items, note, ttl) {
  return { model: MODEL, max_tokens: 16000, system: [{ type: 'text', text: RULES(lang), cache_control: Object.assign({ type: 'ephemeral' }, ttl ? { ttl } : {}) }],
    messages: [{ role: 'user', content: (note ? note + '\n\n' : '') + JSON.stringify(Object.fromEntries(items.map((k, i) => [String(i + 1), k])), null, 1) }] };
}
// The JSON object in an answer's text, or {} when there's none.
function parse(content) {
  const m = /\{[\s\S]*\}/.exec((content || []).map((c) => c.text || '').join(''));
  try { return m ? JSON.parse(m[0]) : {}; } catch (e) { return {}; }
}

async function ask(lang, items, note) {
  for (let tries = 0; ; tries++) {
    const r = await fetch(API + '/messages', { method: 'POST', headers: HEAD, body: JSON.stringify(body(lang, items, note)) });
    if (r.ok) {
      const got = parse((await r.json()).content);
      if (Object.keys(got).length || tries > 1) return got;
      continue;
    }
    if (tries > 3 || (r.status < 500 && r.status !== 429)) throw new Error('Anthropic API ' + r.status + ': ' + (await r.text()).slice(0, 200));
    await new Promise((res) => setTimeout(res, 5000 * (tries + 1)));
  }
}

/* Every chunk at once through the Message Batches API (half price): sent, waited on (a check every 30 seconds),
   then each chunk's answer by its custom_id.  A chunk that errored comes back as {} and its texts are asked again
   one by one, as any failure is. */
async function batch(lang, chunks) {
  const id = (i) => lang.code.replace(/[^A-Za-z0-9]/g, '_') + '-' + i;
  const call = async (method, url, b) => {
    const r = await fetch(url.startsWith('http') ? url : API + url, { method, headers: HEAD, body: b ? JSON.stringify(b) : undefined });
    if (!r.ok) throw new Error('Anthropic API ' + r.status + ' on ' + url + ': ' + (await r.text()).slice(0, 200));
    return r;
  };
  let b = await (await call('POST', '/messages/batches', { requests: chunks.map((items, i) => ({ custom_id: id(i), params: body(lang, items, '', '1h') })) })).json();
  console.log('  batch ' + b.id + ', ' + chunks.length + ' requests');
  while (b.processing_status !== 'ended') {
    await new Promise((res) => setTimeout(res, 30000));
    b = await (await call('GET', '/messages/batches/' + b.id)).json();
    process.stdout.write('\r  ' + JSON.stringify(b.request_counts));
  }
  const out = {};
  (await (await call('GET', b.results_url)).text()).split('\n').filter(Boolean).forEach((line) => {
    const x = JSON.parse(line);
    out[x.custom_id] = x.result && x.result.type === 'succeeded' ? parse(x.result.message.content) : {};
  });
  return chunks.map((items, i) => out[id(i)] || {});
}

// One language: what's missing, in requests of SIZE texts, a few at a time; then each failure once more alone.
async function fill(lang) {
  const dict = S.load(lang.code), todo = S.allKeys(root).filter((k) => !dict[k]), failed = [];
  console.log(lang.code + ': ' + todo.length + ' to translate');
  const chunks = []; for (let i = 0; i < todo.length; i += SIZE) chunks.push(todo.slice(i, i + SIZE));
  const take = (items, got) => items.forEach((k, i) => { const v = got[String(i + 1)], why = S.problem(k, v); if (why) failed.push({ k, why }); else dict[k] = v; });
  if (!NOW && chunks.length) {
    (await batch(lang, chunks)).forEach((got, i) => take(chunks[i], got));
    S.save(lang.code, dict);
  } else {
    let next = 0, done = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const items = chunks[next++];
        take(items, await ask(lang, items));
        done += items.length; S.save(lang.code, dict); process.stdout.write('\r  ' + lang.code + ' ' + done + '/' + todo.length);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
  }
  for (const f of failed) {
    const got = await ask(lang, [f.k], 'Your last translation of this item was not usable: ' + f.why + '.  Keep every HTML tag exactly.');
    if (!S.problem(f.k, got['1'])) dict[f.k] = got['1'];
  }
  S.save(lang.code, dict);
  const left = S.allKeys(root).filter((k) => !dict[k]).length;
  console.log('\n  ' + lang.code + ' done, ' + left + ' left in English');
}

(async () => {
  const langs = which === 'all' ? S.LANGS : S.LANGS.filter((l) => l.code === which);
  if (!langs.length || !root) { console.error('node scripts/site/i18n-site-fill.js <code|all> <built site folder>'); process.exit(1); }
  for (const l of langs) await fill(l);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
