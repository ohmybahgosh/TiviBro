<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Web editor: the web editor*

The same engine as the TV's [set-up tour](The-set-up-tour), with more room: pick per channel, see every group, undo any step.  The tour's QR code opens this page signed in.

- **Keep only your countries** works out each group's country and keeps the ones you tick.  It reads codes at the start of group names ("US \| News", "[UK] Sports"), country words ("Canada Sports", "France Cinema", "Latino / Mexico"), the code most of a group's channels start with ("ARG \| ..."), and the divider group a group sits under ("⫘⫘⫘ CAN ⫘⫘⫘" then "TSN +").  Groups with no country, like sports and event groups, stay unless you tick **Also hide groups with no country**.
- **Same channel, more than once** finds a channel in several qualities and keeps one (Full HD first is a good balance).  It opens on **To check**: only the channels where two copies have the same quality, so TiviBro couldn't tell which to keep.  **All** shows every set, one line each, with a button per copy (FHD, HD, SD…): click the one to keep, and the others are struck through.  Type in **Find a channel** to narrow the list; **Hide extra copies** then works on just the channels found, or on all of them when the search is empty.
- **Hide by keyword** hides groups or channels with words like PPV or 24/7, with a preview.
- **Empty groups** hides groups with nothing left to watch.
- **East and West feeds** finds channels that come in both time zones ("HBO (EAST)" and "HBO (WEST)", "A&E" and "A&E (WEST)") and keeps the feed you pick, **Keep East** or **Keep West**.  The other copies are hidden in one step, and **Also hide groups named West** (or East) hides groups like "USA WEST" too.  Channels that only come in one feed are left alone.
- **Local channels: pick your city** reads the city out of every station in your local groups ("ABC Locals", "CBS Locals" and so on: ABC, CBS, NBC, FOX, CW, PBS, Telemundo, Univision, CBC, CTV, Global and more).  Type to find your city, tick it (or a few nearby, like Detroit and Lansing), and **Keep only these cities** hides every other city's stations in all the local groups at once.  **Keep stations with no city** leaves national feeds alone.  **Also put them together in one group called** ("Local channels", or a name of your own) copies the stations you keep into one group, by city and network, and **Then hide the network groups** hides ABC Locals, CBS Locals and the rest, so each station shows up once.  Running it again adds to the same group.
- **Divider groups** hides groups like "⫘⫘⫘ UK ⫘⫘⫘" or "===== SPORTS =====" that only split the provider's list into sections.
- **Channels with nothing on** is the same switch as **Hide channels with nothing on** on the TV: event channels named "Off Air", "Offline" or "No Event Scheduled" stay out of the lists while they say so.

Everything here only hides, never deletes, and each action is one undo step.

<p align="center">
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-smart-cleanup.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-smart-cleanup.png" width="49%" alt="Smart clean-up"></a>
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-feeds-local.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-feeds-local.png" width="49%" alt="East and West feeds, and local channels by city"></a>
</p>

---

← [Groups and channels](Groups-and-channels)  ·  [Home](Home)  ·  [Channel names](Channel-names) →
