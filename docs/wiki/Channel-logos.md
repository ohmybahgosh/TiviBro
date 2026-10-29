<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*On the TV*

Providers often leave logos out, or send some that no longer load.  The **logo library** fills them in from two open projects:

- **[iptv-org](https://github.com/iptv-org/database)**: each channel's own logo, for about 28,000 channels in 230 countries.
- **[tv-logos](https://github.com/tv-logo/tv-logos)**: one matching style made for dark screens, for about 7,700 channels.

TiviBro hosts no logo images.  It downloads a small list of where the logos are, only for the countries in your playlist, and each logo loads from its own project, the way your provider's logos do.  The list is kept on the TV for a week.

Channels are matched by their guide id ("CNN.us"), then by their cleaned name in their own country, then by a local station's call sign ("WXYZ") or, for a local station with no logo of its own, its network.  Event channels are left alone, since their names are games.  A provider logo that fails to load is replaced by the library's.

Turn it on in the set-up tour or in **Settings > Appearance > Logo library**:

- **Off**: only the playlist's and the guide's logos.
- **Fill in missing logos**: the library's logo for channels that have none.
- **Use for every channel it knows**: the library's logo everywhere it has one, so the whole list matches.

**Logo library style** picks **Matching set** (tv-logos) or **Original logos** (iptv-org); each falls back to the other.  On a real 9,800-channel playlist it found logos for about 3,600 channels.

---

← [The set-up tour](The-set-up-tour)  ·  [Home](Home)  ·  [The remote](The-remote) →
