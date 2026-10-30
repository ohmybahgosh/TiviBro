/* Visit counts for tivibro.app with Google Analytics 4, only after the visitor says yes.
   Switched on by the measurement ID in <meta name="ga-id" content="G-XXXXXXXXXX"> in index.html;
   while that is empty nothing loads and no banner shows.  The choice is kept in this browser
   (localStorage), and "Cookie settings" in the footer asks again.  The TV app has no analytics. */
(function () {
  var meta = document.querySelector('meta[name="ga-id"]'), ID = meta && meta.content.trim();
  var KEY = 'tivibro.analytics', loaded = false;
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  function load() {
    if (loaded || !ID) return; loaded = true;
    gtag('js', new Date());
    gtag('config', ID, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID);
    document.head.appendChild(s);
  }
  function banner() {
    var old = document.getElementById('consent'); if (old) old.remove();
    var b = document.createElement('div'); b.id = 'consent'; b.className = 'consent'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Analytics');
    b.innerHTML = '<p><b>Can we count your visit?</b>  tivibro.app uses Google Analytics to see which pages help people.  The TiviBro app on your TV never tracks you.</p>' +
      '<div><button type="button" class="btn sm primary" data-c="yes">Allow</button><button type="button" class="btn sm ghost" data-c="no">No thanks</button></div>';
    b.addEventListener('click', function (e) {
      var c = e.target.getAttribute && e.target.getAttribute('data-c'); if (!c) return;
      set(c); b.remove(); if (c === 'yes') load();
    });
    document.body.appendChild(b);
  }
  // What people do here, as events: install steps copied, install tab, GitHub links, videos opened.
  function track(name, params) { if (loaded) gtag('event', name, params || {}); }
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('a, button') : null; if (!t) return;
    if (t.closest('.copy')) return track('copy_install', { what: (t.parentNode.querySelector('code') || {}).textContent || '' });
    if (t.getAttribute('role') === 'tab') return track('install_tab', { tab: t.getAttribute('data-tab') });
    if (t.classList.contains('expand')) return track('video_fullscreen');
    var h = t.getAttribute('href') || '';
    if (/github\.com/.test(h)) return track('github_link', { to: h.replace(/^https:\/\/github\.com\//, '') });
    if (h === '#install') return track('install_button');
  }, true);
  if (!ID) return;
  var link = document.getElementById('consentLink'); if (link) { link.hidden = false; link.addEventListener('click', function (e) { e.preventDefault(); banner(); }); }
  if (get() === 'yes') load(); else if (get() !== 'no') banner();
})();
