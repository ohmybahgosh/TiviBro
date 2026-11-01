# TMDB user setup

Public TiviBro builds contain no TMDB key or token.  Each viewer creates their own TMDB API key or API Read Access Token through [TMDB API settings](https://www.themoviedb.org/settings/api).

1. In the TV app, open **Settings > My media > TMDB API token**.  Alternatively, open **My media** in the web editor and paste the token there.
2. Paste the API key or raw Read Access Token, without a `Bearer ` prefix.  TMDB access is checked before the new value replaces the previous token.
3. Choose a metadata language and save.  Use **Yellow** on My media to fetch missing movie details, or select a source in Settings to refresh all its details.

The token is stored under the TV's private My media storage key, separate from playlist settings, backups and problem reports.  Public preferences report only whether a token is set.  The editor's token field is always empty; leaving it blank keeps the saved value.  Removing a token keeps the movie library and cached details.

The app sends the token to the protected localhost helper only for each metadata request.  The helper uses it to authenticate directly to TMDB over verified HTTPS and does not retain a shared application credential.  Provider logins and playback addresses never reach TMDB.  Existing Cinemeta IMDb matches migrate through TMDB's find endpoint; later refreshes retain TMDB IDs and manual choices.

The preferred language maps to a TMDB locale such as `nl-NL`.  Only missing translated fields use the English response; `fallbackFields` identifies those fields.  Posters prefer the chosen language, then language-neutral or English images.  Poster and backdrop sizes are bounded.

The build removes `service/media-tmdb-key.js`, a credential file produced by older local builds, before packaging.  It never reads a developer token file or injects an application key.  No credential is stored in Git or public packages.

[TMDB attribution](https://developer.themoviedb.org/docs/faq) is displayed in Settings > Updates and about and in the web editor.  `app/img/tmdb.svg` is the unmodified approved blue-short TMDB logo; the build copies it to the editor.
