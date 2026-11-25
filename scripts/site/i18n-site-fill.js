#!/usr/bin/env node
/* Translates what's missing on tivibro.app into one language (or all) with Claude (the Anthropic API), checked
   like any import (scripts/site/i18n-site.js problem) and written to site/i18n/<code>.json.
     node scripts/site/i18n-site-fill.js de _site           one language, from the built site
     node scripts/site/i18n-site-fill.js all _site          every language
   Build the site first (cp -r site/. _site && node scripts/site/build-pages.js _site).  The key comes from
   ANTHROPIC_API_KEY (never commit it); I18N_MODEL picks the model.  The rules go first as the system prompt,
   cached, so each request after the first reads them cheaply.  A text that fails a check is asked once more on its
   own, told what was wrong, then left in English for a person. */
'use strict';
const S = require('./i18n-site.js');
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.I18N_MODEL || 'claude-sonnet-5-5';
const [which, root] = process.argv.slice(2), SIZE = 30, PARALLEL = 4;
if (!KEY) { console.error('ANTHROPIC_API_KEY is not set.  Without it: i18n-site.js todo <code>, translate, i18n-site.js import <code> done.json'); process.exit(1); }

// The app speaks formally in these (app/js/lang), so the site does too.
const FORMAL = ['fr', 'ru', 'tr'];
const RULES = (lang) => [
  'You translate the website of TiviBro, a free IPTV player app for LG webOS TVs, from English into ' + lang.english + ' (' + lang.code + ').',
  'Each item is a piece of a web page, sometimes with HTML tags inside.  Keep every tag exactly as it is (same tags, same attributes, same order where the grammar allows), and translate only the words between them.  Never translate what is inside <code>.',
  'Keep these as they are: TiviBro, TiviMate, Plex, Plex Pass, webOS, LG, Magic Remote, Homebrew Channel, Developer Mode, Xtream Codes, M3U, XMLTV, Stalker, EPG, TMDB, TheTVDB, Trakt, IntroDB, TheIntroDB, OpenSubtitles, GitHub, Google Play, Android, APK, IPK, WebDAV, DLNA, SMB, NAS, HDR, Dolby Vision, Atmos, DTS, Multiview, product and company names, numbers, prices, addresses and file names.',
  'Plain, friendly words for TV viewers, addressing the reader the way the TiviBro app does: ' + (FORMAL.indexOf(lang.code) >= 0 ? 'the polite form (vous, вы, siz).' : 'the informal form (du, tú, tu, jij, ty, você).') + '  Never use an em dash.  Keep emoji and flags.',
  'Answer with one JSON object only: {"1": "translation", "2": "translation", ...}, a translation for every number.'
].join('\n');

async function ask(lang, items, note) {
  const body = { model: MODEL, max_tokens: 16000, system: [{ type: 'text', text: RULES(lang), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: (note ? note + '\n\n' : '') + JSON.stringify(Object.fromEntries(items.map((k, i) => [String(i + 1), k])), null, 1) }] };
  for (let tries = 0; ; tries++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (r.ok) {
      const j = await r.json(), text = (j.content || []).map((c) => c.text || '').join('');
      const m = /\{[\s\S]*\}/.exec(text);
      try { return JSON.parse(m[0]); } catch (e) { if (tries > 1) return {}; continue; }
    }
    if (tries > 3 || (r.status < 500 && r.status !== 429)) throw new Error('Anthropic API ' + r.status + ': ' + (await r.text()).slice(0, 200));
    await new Promise((res) => setTimeout(res, 5000 * (tries + 1)));
  }
}

// One language: what's missing, in requests of SIZE texts, a few at a time; then each failure once more alone.
async function fill(lang) {
  const dict = S.load(lang.code), todo = S.allKeys(root).filter((k) => !dict[k]), failed = [];
  console.log(lang.code + ': ' + todo.length + ' to translate');
  const chunks = []; for (let i = 0; i < todo.length; i += SIZE) chunks.push(todo.slice(i, i + SIZE));
  let next = 0, done = 0;
  async function worker() {
    while (next < chunks.length) {
      const items = chunks[next++], got = await ask(lang, items);
      items.forEach((k, i) => { const v = got[String(i + 1)], why = S.problem(k, v); if (why) failed.push({ k, why }); else dict[k] = v; });
      done += items.length; S.save(lang.code, dict); process.stdout.write('\r  ' + lang.code + ' ' + done + '/' + todo.length);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
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
