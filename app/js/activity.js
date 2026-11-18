/* What TiviBro is doing in the background, in a small chip in the bottom right corner on every screen (not
   over fullscreen video), like the guide's own loading chip (epg.js) and just above it while that one shows:
   scanning a My media source, fetching movie and show details from TMDB.  Several at once take turns every 4 seconds.  Each part says what it is doing with
   Activity.set(id, text), and Activity.set(id, '') when it is done. */
var Activity = (function () {
  'use strict';
  var items = {}, order = [], at = 0, el = null, timer = null;
  function box() {
    if (!el && typeof document !== 'undefined' && document.body) { el = document.createElement('div'); el.id = 'activity'; el.className = 'activity hidden'; el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    return el;
  }
  function draw() {
    var b = box(); if (!b) return;
    if (!order.length) { b.classList.add('hidden'); b.textContent = ''; return; }
    at = at % order.length;
    // "Fetching details: 120 movies to go": the first part bold, as the guide's chip says "Loading guide 14%".
    var t = items[order[at]], c = t.indexOf(': ');
    b.innerHTML = '';
    b.appendChild(U.el('b', '', c > 0 ? t.slice(0, c) : t));
    if (c > 0) b.appendChild(document.createTextNode(t.slice(c + 2)));
    if (order.length > 1) b.appendChild(U.el('small', '', '  ' + (at + 1) + '/' + order.length));
    b.appendChild(U.el('i', 'indet'));
    var g = document.getElementById('epgProg');
    b.classList.toggle('above', !!(g && !g.classList.contains('hidden') && g.offsetHeight));
    b.classList.remove('hidden');
  }
  function set(id, text) {
    text = String(text || '');
    if (text) { if (!items[id]) order.push(id); items[id] = text; }
    else if (items[id]) { delete items[id]; order.splice(order.indexOf(id), 1); }
    // Every 4 s: the next one's turn, and the place (above the guide's chip while it shows).
    if (order.length && !timer) timer = setInterval(function () { at++; draw(); }, 4000);
    if (!order.length && timer) { clearInterval(timer); timer = null; at = 0; }
    draw();
  }
  function list() { return order.map(function (k) { return items[k]; }); }
  return { set: set, list: list };
})();
