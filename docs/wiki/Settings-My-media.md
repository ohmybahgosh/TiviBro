<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Every setting*

Your own movie and TV show sources and their preferences.  The [My media](My-media) screen keeps the shelves full-width; source setup stays here.  The phone app's **Settings > My media** does all of this too, with the typing on the phone.

<p align="center"><a href="https://tivibro.app/view/#tv-set-my-media"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/tv-set-my-media.png" width="70%" alt="Settings: My media"></a></p>

| Settings > My media | Default | What it does |
|---|---|---|
| **Add media** | | Find a DLNA / UPnP server, or enter the WebDAV address of your media folder and its login.  **Dropbox** is signed in from the phone app.  Subfolders are scanned too.  One folder per movie, named like **Frozen (2013)**, matches best.  In the phone app the server list and the WebDAV form are on the phone. |
| **Edit on a computer** *(on the TV)* | | Shows a code for a computer or phone browser: the web editor's My media page, for typing server logins and fixing TV show episodes. |
| **Rescan media sources** | | Same as Green on My media: scan every saved source for movies and episodes. |
| **Fetch media details** | | Same as Yellow: look up details for movies, shows and the episodes you have, and refresh outdated language details. |
| **TMDB API token ›** | | Under **Preferences**.  Opens [API keys](Settings-API-keys), the one place the token lives: add, test or remove it there. |
| **Sort movies by** | **Name (A–Z)** | Name, release date (newest first), or date added (newest first).  Movies and Favorites follow this choice; Continue watching stays ordered by recent playback.  Rescans preserve the date first added. |
| **Sort TV shows by** | **Name (A–Z)** | Name, first aired (newest first), or date added (newest first).  TV shows and favorite shows follow it, on the TV and in the phone app; Continue watching stays ordered by recent playback. |
| **Favorites also in lists** | **On** | On: a favorite movie or show is in **Favorites** and also in **Movies** or **TV shows**.  Off: it is only in **Favorites**. |
| **Metadata language** | **English** | Shared by the TV app and web editor.  Changing it refreshes saved movie and show matches in the selected language.  Only missing translated fields fall back to English, identified beside the details.  If a request fails, the previous details remain. |
| *(each source)* | | Under **Media sources**, with how many movies and episode files it has.  **Content** (Movies only, Movies and TV shows, TV shows only), rescan, pause or restart a scan, fetch details, or remove the source. |

---

← [Settings: Movies and shows](Settings-Movies-and-shows)  ·  [Home](Home)  ·  [Settings: API keys](Settings-API-keys) →
