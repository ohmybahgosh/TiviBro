<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*On the TV*

**My media** gives your own movies a full-width poster view, with **Continue watching**, **Favorites** and **All movies** shelves.  The movie you choose shows its title and description above the shelves.  There are no automatic trailers or previews.

Press **Green** on My media to rescan all saved sources for new or removed movies.  Press **Yellow** to fetch details and artwork for new movies or outdated language matches.  Yellow leaves up-to-date matches alone.  Wait for a rescan to finish before fetching details.

Use **Left** and **Right** to move between movies, and **Up** and **Down** to move between shelves.  **OK** plays or resumes the selected movie.  **Hold OK** or **Red** opens movie options: add or remove a favorite, start over, mark as watched, find or correct movie details, or see file information.  Favorites and your place in a movie stay with My media across playlists and restarts.

**Back** opens the standard main menu directly.  **Left** from the first movie does the same.  There is no separate source menu on the movie screen; all sources appear together and source management stays in Settings.

**Add media and preferences are in Settings > My media**, not in the movie shelves.  **Blue** from My media opens those settings directly.  Choose **Add media > Browse my network (DLNA / UPnP)** to find a home server, or **Add a WebDAV server** and enter its WebDAV address and login.  Turn on media sharing on a home server first.  A playlist must already be set up.

A WebDAV source is a WebDAV folder, not a normal website or HTTP directory.  Services such as premiumize use a customer ID and API key as the login.  Listing uses WebDAV; playback currently needs the server to redirect to a playable file link.  Servers that serve files directly with a login are not supported yet.

For easier typing, open **Settings > My media > Edit on a computer** and connect to the web editor.  Its **My media** page lets you add WebDAV logins, rescan or remove sources, and change the shared metadata language.  Saved logins are never sent back to the editor.

In **Settings > My media**, choose a saved source for **Rescan**, **Fetch movie details**, or **Remove**.  Removing a source leaves your files alone.  A failed, incomplete or empty scan keeps the previous library.

**Movie details:** **Fetch movie details** looks up a source's movies on TMDB.  Create your own API key or API Read Access Token at [TMDB API settings](https://www.themoviedb.org/settings/api), then save it under **Settings > My media > TMDB API token**.  You can paste it in the web editor instead of typing with the remote.  The token is checked before saving, kept only on this TV, never sent back to the editor, and excluded from backups and problem reports.  Public builds contain no token.  Fetching details sends movie titles/years or saved movie IDs to TMDB.  Only an exact, unambiguous title/year match is saved automatically; use **Find movie details** or **Change movie details** in a movie's options to search and choose a match.  **Remove movie details** clears it.  Posters and backdrops load from image.tmdb.org.  Existing matches, including manually corrected matches, are refreshed by ID rather than searched again.  Details and poster addresses survive rescans and restarts.

Movies use the usual seek bar and subtitle menu.  Embedded SRT text subtitles in MKV files can appear when the file has a usable subtitle index.  ASS/SSA, image subtitles such as VobSub or PGS, MP4 timed text and separate `.srt` files are not included yet.  **Back** hides the player controls first, then returns to the same movie.  Series, folder picking, Search and phone app browsing are not included yet.

Playback contacts servers you add and their playback servers.  Fetching details also contacts api.themoviedb.org with titles/years or saved movie IDs and the preferred language, never your source logins or playback links.  Previously saved Cinemeta posters may still load from images.metahub.space until those movies are refreshed.  Cloud playback links are resolved each time you play and are never saved.  After a long pause with an expired link, return to the shelves and resume.  The library uses the helper's persistent storage, so app restarts and updates keep it even when browser storage is full.  Source logins are outside playlist backups and problem reports; add the sources again after restoring on another TV.  Up to eight sources can be saved.

---

← [Movies and shows](Movies-and-shows)  ·  [Home](Home)  ·  [Search](Search) →
