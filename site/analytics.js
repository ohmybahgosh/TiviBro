/* Visit counts for tivibro.app with Google Analytics 4, only after the visitor says yes.
   Switched on by the measurement ID in <meta name="ga-id" content="G-XXXXXXXXXX"> on each page that
   loads this file (the home page, /view/ and /apk/); while that is empty nothing loads and no banner shows.
   <meta name="ga-banner" content="off"> (on /apk/, which leaves at once) counts only people who already said yes.  The choice is kept in this browser
   (localStorage), and "Cookie settings" in the footer asks again.  The TV app has no analytics (only the anonymous daily count in app/js/update.js). */
(function () {
  var meta = document.querySelector('meta[name="ga-id"]'), ID = meta && meta.content.trim();
  var KEY = 'tivibro.analytics', loaded = false;
  var bannerOff = !!document.querySelector('meta[name="ga-banner"][content="off"]');
  window.tivibroAnalytics = { on: function () { return loaded; } };
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  function internal() {
    var m = /[?&]internal=([01])/.exec(location.search);
    if (m) { try { if (m[1] === '1') localStorage.setItem('tivibro.internal', '1'); else localStorage.removeItem('tivibro.internal'); } catch (e) {} }
    try { return localStorage.getItem('tivibro.internal') === '1'; } catch (e) { return false; }
  }
  function load() {
    if (loaded || !ID) return; loaded = true;
    gtag('js', new Date());
    var cfg = { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false };
    // Your own visits: open tivibro.app/?internal=1 once in each browser (?internal=0 undoes it).  GA4's
    // Internal traffic data filter drops them from the reports.
    if (internal()) cfg.traffic_type = 'internal';
    gtag('config', ID, cfg);
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID);
    document.head.appendChild(s);
  }
  // Pages without style.css (/view/) get the banner's look from here.
  function bannerStyle() {
    if (document.querySelector('link[href*="style.css"]') || document.getElementById('consentStyle')) return;
    var st = document.createElement('style'); st.id = 'consentStyle';
    st.textContent = '.consent{position:fixed;left:20px;bottom:20px;z-index:60;max-width:440px;padding:18px 20px;border-radius:18px;background:rgba(17,22,43,.96);border:1px solid #2d3760;box-shadow:0 24px 60px rgba(0,0,0,.55);color:#9aa4c4;font:14px/1.5 Inter,system-ui,sans-serif;text-align:left}' +
      '.consent p{margin:0 0 14px}.consent b{color:#e8ecf8}.consent a{color:#33e1ff}.consent div{display:flex;gap:10px}' +
      '.consent button{padding:8px 16px;border-radius:11px;border:1px solid #2d3760;background:rgba(17,22,43,.6);color:#e8ecf8;font:600 14px Inter,system-ui,sans-serif;cursor:pointer}' +
      '.consent button[data-c="yes"]{background:linear-gradient(135deg,#5b8cff,#4a6fff 55%,#6f5cff);border-color:transparent}' +
      '@media (max-width:600px){.consent{left:12px;right:12px;bottom:12px;max-width:none}}';
    document.head.appendChild(st);
  }
  function banner() {
    bannerStyle();
    var old = document.getElementById('consent'); if (old) old.remove();
    var b = document.createElement('div'); b.id = 'consent'; b.className = 'consent'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Analytics');
    b.innerHTML = '<p><b>Can we count your visit?</b>  tivibro.app uses Google Analytics to see which pages help people.  The TiviBro app on your TV doesn\'t track you.  <a href="/privacy/">Privacy</a></p>' +
      '<div><button type="button" class="btn sm primary" data-c="yes">Allow</button><button type="button" class="btn sm ghost" data-c="no">No thanks</button></div>';
    b.addEventListener('click', function (e) {
      var c = e.target.getAttribute && e.target.getAttribute('data-c'); if (!c) return;
      set(c); b.remove(); if (c === 'yes') { load(); window.dispatchEvent(new Event('tivibro:analytics')); }
    });
    document.body.appendChild(b);
  }
  /* What people do here.  Every event and parameter is registered in GA4 (Admin > Custom definitions),
     so a new one needs a custom dimension there too.
       click_install_button   button_location: nav | hero | footer_cta
       select_install_method  install_method: homebrew | rooted | devmode
       copy_install           install_method, copied_text            (a key event)
       click_github           link_target: repo | releases | issues | wiki | profile | other, link_location: the section
       open_video_fullscreen  video_name: guide | web_editor
       open_faq               faq_question
       view_install_steps     (no parameters) the install section was seen: step 2 of the install funnel
       view_section           section_name (once per page view, after a second with half of it, or half the screen, showing)
       click_apk_download     link_location: the section with the /apk/ link
       download_apk           (no parameters) /apk/ found the newest APK and is starting the download */
  var METHOD = { hbc: 'homebrew', root: 'rooted', dev: 'devmode' };
  function track(name, params) { if (loaded) gtag('event', name, params || {}); }
  function sectionOf(el) { var s = el.closest && el.closest('section[id], header, footer'); return s ? (s.id || s.tagName.toLowerCase()) : 'page'; }
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('a, button, summary') : null; if (!t) return;
    if (t.tagName === 'SUMMARY') { if (!t.parentNode.open) track('open_faq', { faq_question: t.textContent.trim().slice(0, 100) }); return; }
    if (t.closest('.copy')) {
      var panel = t.closest('[data-panel], [role="tabpanel"]'), on = document.querySelector('[role="tab"][aria-selected="true"]');
      var m = panel && (panel.getAttribute('data-panel') || panel.id) || (on && on.getAttribute('data-tab')) || '';
      return track('copy_install', { install_method: METHOD[m] || m || 'unknown', copied_text: ((t.parentNode.querySelector('code') || {}).textContent || '').slice(0, 100) });
    }
    if (t.getAttribute('role') === 'tab') return track('select_install_method', { install_method: METHOD[t.getAttribute('data-tab')] || t.getAttribute('data-tab') });
    if (t.classList.contains('expand') || t.classList.contains('bigvid')) return track('open_video_fullscreen', { video_name: /live-edit/.test((t.parentNode.querySelector('video') || {}).src || '') ? 'web_editor' : 'guide' });
    var h = t.getAttribute('href') || '';
    if (/github\.com/.test(h)) {
      var path = h.replace(/^https:\/\/github\.com\//, '').split(/[?#]/)[0];
      var target = /\/releases/.test(path) ? 'releases' : /\/issues/.test(path) ? 'issues' : /\/wiki/.test(path) ? 'wiki' : /^[^/]+\/[^/]+\/?$/.test(path) ? 'repo' : /^[^/]+\/?$/.test(path) ? 'profile' : 'other';
      return track('click_github', { link_target: target, link_location: sectionOf(t) });
    }
    if (/^\/apk\/?$/.test(h)) return track('click_apk_download', { link_location: sectionOf(t) });
    if (h === '#install') return track('click_install_button', { button_location: t.closest('.top, header') ? 'nav' : t.closest('#hero') ? 'hero' : 'footer_cta' });
  }, true);
  // Videos are tapped directly too (they open full screen).
  document.addEventListener('click', function (e) { if (e.target.classList && e.target.classList.contains('bigvid')) track('open_video_fullscreen', { video_name: /live-edit/.test(e.target.src) ? 'web_editor' : 'guide' }); }, true);
  // How far people get: each main section once per page view.
  if ('IntersectionObserver' in window) {
    // Counted after a second on screen, so scrolling past (or jumping to #install) doesn't count.
    var seen = {}, wait = {}, io = new IntersectionObserver(function (es) {
      es.forEach(function (x) {
        var id = x.target.id;
        // Half of it on screen, or half the screen for sections taller than the screen.
        if (!(x.isIntersecting && (x.intersectionRatio >= 0.5 || x.intersectionRect.height >= innerHeight * 0.5))) { clearTimeout(wait[id]); return; }
        if (seen[id]) return;
        clearTimeout(wait[id]);
        wait[id] = setTimeout(function () { if (!seen[id]) { seen[id] = 1; track('view_section', { section_name: id }); if (id === 'install') track('view_install_steps'); } }, 1000);
      });
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] });
    document.querySelectorAll('section[id]').forEach(function (s) { io.observe(s); });
    // Sections already seen before consent count once it is given.
    window.addEventListener('tivibro:analytics', function () { seen = {}; document.querySelectorAll('section[id]').forEach(function (s) { io.unobserve(s); io.observe(s); }); });
  }
  if (!ID) return;
  var link = document.getElementById('consentLink'); if (link) { link.hidden = false; link.addEventListener('click', function (e) { e.preventDefault(); banner(); }); }
  if (get() === 'yes') load(); else if (get() !== 'no' && !bannerOff) banner();
})();
