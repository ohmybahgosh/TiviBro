/* Every feature: the "N features and growing" section.  Fills [data-features] with one card per group,
   each showing its first few features with the rest folded behind "+ N more", and a search box that
   narrows every group at once.  Used on tivibro.app and copied to ohmybahgosh.dev/tivibro. */
(function () {
  // Each group: icon, name, features.  A leading "*" marks something only TiviBro does, "+" something new lately.
  var GROUPS = [
    ['📺', 'Live TV and the guide', ['Guide-first layout', 'Live preview in the guide', 'Catch-up', 'Two-line programmes', 'Colour by category', 'Dim past programmes', 'Guide row size', 'Mark what\'s on now', 'Several days of guide', 'Programme details', 'Reminders from the guide', 'Recent channels', 'Favorites', 'Your own groups', 'Channel numbers', 'Hide and sort channels', 'Hide channels with nothing on', '*Public guide fill-in', '*Wrong time zone fixed', '+*Public guides with wrong times left out', 'Match guide by name', 'Movies on now', 'Search everything', 'Watchlist']],
    ['⏯️', 'Watching', ['Pause live TV', 'Rewind live TV', 'Timeline in the player', '*Switches to a working copy', 'Other versions of a channel', 'Reconnect on drop', 'Freeze detection', 'Keep the picture while reconnecting', 'Buffer profiles', 'Buffer meter', 'Seek previews', 'Info panel', 'Stream details', 'Aspect modes', 'Quick menu', 'Audio sync per channel', '*Multiview: two channels', 'Burn-in protection', 'Turn on last channel', 'Ask when slow to start']],
    ['🎬', 'Movies and shows', ['Posters and backdrops', 'Seasons and episodes', 'Trailers', 'Resume where you left off', 'My list', 'Languages filter', 'Movie details in the guide', 'Series details in the guide', '+Details from TheTVDB, no token', '+Where details come from', 'Hide spoilers', 'Up next countdown', 'Play the next one automatically', '+Skip intro', '+Skip recap', '+Skip credits', '+Skip times from TheIntroDB and IntroDB', 'Count as watched at', 'Order categories', '*Probably shows / Probably movies']],
    ['🍿', 'Plex', ['+Plex in its own tab', '+Sign in with a code', '+Home rows and libraries', '+Title pages with cast and extras', '+Collections and categories', '+Plex quality list', '+Subtitle search', '+Streaming Top 10s you have', '+Resume and watched marks synced', '+Plex in the phone app']],
    ['📂', 'My media', ['Windows shares', 'DLNA servers', 'WebDAV', 'Google Drive', 'Dropbox', 'Plex-style shelves', 'Continue watching', 'Unmatched movies to fix', 'Shows that need review', 'Excluded files', 'Trakt sync', 'Trakt lists and charts', 'Bring Trakt history in', 'MKV and MP4 subtitles']],
    ['🏈', 'Sports', ['Live scores', 'A page for every game', 'Box scores and leaders', 'Standings', '*Scores in the corner', '*Close-finish alert', 'Hide scores', 'My teams', '*Your teams tinted in the guide', '*Games matched to your channels', 'Event channels by time', '*Reads PPV and event names', 'Formula 1 to college football', '+Formula 1 by session', '+Follow Formula 1', '+Cricket', '+Follow cricket sides', 'Sports in the phone app']],
    ['🔊', 'Sound and subtitles', ['+Dialogue boost', '+Night mode', 'Audio language', 'Fallback audio language', 'Prefer surround', '*DTS and TrueHD converted', 'HDR and Dolby Vision', 'Atmos passthrough', 'Subtitles automatically', 'Closed captions', 'Subtitle colour, size, background', 'OpenSubtitles', 'Subtitle languages', 'Forget audio sync']],
    ['⏺️', 'Recording', ['Free DVR', 'Record to USB', 'Record to a Windows share', 'Record to WebDAV', 'Start early', 'Delete watched recordings', 'Live pause on a network share', 'Rewind buffer size', '+Pick the USB partition', 'Recordings screen']],
    ['📱', 'Phone and web editor', ['*Set up from your phone', 'QR code sign-in', 'Android phone app', 'Phone remote', 'Type on your phone', '*Phone settings while away', '+Phone finds a moved TV', '*Web editor in any browser', 'Drafts and Send to TV', '*Smart clean-up', 'Bulk rename', 'Guide matching in the editor', 'Pair several phones']],
    ['🧹', 'Clean names and logos', ['*Set-up tour', 'Keep the countries you watch', 'East or West feeds', 'Your city\'s locals', '*Clean channel names', 'Clean group names', 'Country prefixes removed', 'Quality tags removed', 'Decorative symbols removed', '*Logo library', 'One logo style', 'Short event names']],
    ['🎨', 'Look and feel', ['Sixteen themes', 'Accent colour', 'Custom hue', 'Backgrounds', 'Focus style', 'Text size', 'Panels over video', 'Clock and date', 'Start screen', '+OLED screensaver', '+Screen off instead', '+Settings home cards', '*Settings that keep playing', 'Search settings']],
    ['🎛️', 'Remote and buttons', ['Learn a button', 'Button tester', 'Every button remappable', 'Hold OK', 'Colour buttons', 'CH+ and CH-', 'Up and Down in fullscreen', 'Press Back twice to exit']],
    ['🔐', 'Playlists, privacy and safety', ['Several playlists', 'Xtream, M3U and Stalker', '+Movies-only playlists', '+ClearKey channels', 'DNS choice', 'Custom User-Agent', 'Subscription end warning', 'Parental PIN', 'Hide adult channels', '*Locked backups', 'Restore points', '*Signed updates', 'No tracking in the app', '*Network helper', 'Errors in plain words', 'Report a problem', 'Speed test', 'Connection test', '+10 languages', 'Open from other apps']]
  ];
  var SHOW = 8;   // features shown per group before "+ N more"
  var grid = document.querySelector('[data-features]'), find = document.querySelector('[data-features-find]');
  if (!grid) return;

  // Escapes a feature name for innerHTML.
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // Builds one group's card and returns how many features it holds.
  function card(g) {
    var el = document.createElement('div'), list = g[2];
    el.className = 'af-cat';
    el.innerHTML = '<h3><span class="af-ic" aria-hidden="true">' + g[0] + '</span>' + esc(g[1]) + '<span class="af-n">' + list.length + '</span></h3><ul class="af-list"></ul>';
    var ul = el.querySelector('ul');
    list.forEach(function (raw, i) {
      var name = raw.replace(/^[+*]+/, ''), dot = raw.charAt(0) === '+' ? 'new' : raw.indexOf('*') >= 0 ? 'only' : '';
      var li = document.createElement('li');
      li.className = 'af-f' + (i >= SHOW ? ' af-more-f' : '');
      li.setAttribute('data-name', name);
      li.innerHTML = (dot ? '<i class="af-' + dot + '" title="' + (dot === 'new' ? 'New lately' : 'Only in TiviBro') + '"></i>' : '') + '<span>' + esc(name) + '</span>';
      ul.appendChild(li);
    });
    if (list.length > SHOW) {
      var b = document.createElement('button'), more = '+ ' + (list.length - SHOW) + ' more';
      b.type = 'button'; b.className = 'af-more'; b.textContent = more; b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function () {
        var open = el.classList.toggle('af-open');
        b.textContent = open ? 'Show fewer' : more; b.setAttribute('aria-expanded', open);
      });
      el.appendChild(b);
    }
    grid.appendChild(el);
    return list.length;
  }

  var total = 0;
  GROUPS.forEach(function (g) { total += card(g); });
  [].forEach.call(document.querySelectorAll('[data-features-total]'), function (t) { t.textContent = total; });

  // Search: keeps only the features whose name has the words typed, in every group, with the match marked.
  function search() {
    var q = find.value.trim().toLowerCase();
    grid.classList.toggle('af-searching', !!q);
    [].forEach.call(grid.querySelectorAll('.af-cat'), function (c) {
      var any = false;
      [].forEach.call(c.querySelectorAll('.af-f'), function (f) {
        var n = f.getAttribute('data-name'), at = q ? n.toLowerCase().indexOf(q) : -1, s = f.querySelector('span');
        f.classList.toggle('af-hit', at >= 0);
        any = any || at >= 0;
        s.innerHTML = at >= 0 ? esc(n.slice(0, at)) + '<mark>' + esc(n.slice(at, at + q.length)) + '</mark>' + esc(n.slice(at + q.length)) : esc(n);
      });
      c.classList.toggle('af-has', any);
    });
  }
  if (find) find.addEventListener('input', search);
})();
