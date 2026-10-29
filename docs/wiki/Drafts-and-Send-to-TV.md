<!-- Generated from docs/USER-GUIDE.md by scripts/wiki/build.js.  Edit the guide, not this page. -->

*Web editor: the web editor*

Every change is a **draft** until you press **Send to TV** (or <kbd>Ctrl</kbd>+<kbd>S</kbd>).  A bar at the bottom counts what hasn't reached the TV, and turns green when the TV confirms.

- **Review** lists every change in plain words before sending.  **Send automatically** sends as you go.
- <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes, <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redoes, even after sending.
- **Restore points** live on the TV.  It makes one before applying each batch (keeps the last 15), and you can make named ones before big changes.  Restoring one is itself undoable.
- **Changes and restore points** lists what hasn't reached the TV yet, this session's changes (each with **Go back**), your draft history, and the restore points.

<p align="center">
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-history.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-history.png" width="100%" alt="Changes and restore points"></a>
</p>

**You can't lose unsent work.**  An hour of clean-up shouldn't vanish because of a stray click, a refresh or a closed tab, so the editor saves your drafts twice:

- **In this browser,** the moment you make a change.
- **On the TV,** a few seconds later (at least every 30 seconds while you keep working).  The bar at the bottom says when: *Draft saved on the TV at 8:41*.  If the TV can't be reached it says so, and the browser copy still holds your work.

Reload the page, close the tab, or open the editor on another computer or your phone, and it asks whether to pick up your unsent changes, whichever copy is newer.  **Keep working on them** brings everything back; **Throw them away** clears them, but a copy stays in the draft history.

<p align="center">
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-recover.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-recover.png" width="49%" alt="Unsent changes offered back after a reload"></a>
  <a href="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-drafts.png"><img src="https://github.com/ohmybahgosh/TiviBro/raw/main/docs/screenshots/editor-drafts.png" width="49%" alt="Draft history"></a>
</p>

**Draft history** (on **Changes and restore points**) keeps versions of your unsent work on the TV:

- one every few minutes, or every 20 changes, while you work;
- one just before you send, and one before you discard;
- and any you name with **Save a version** (for example *Before hiding the sports groups*).

**Open** goes back to a version and keeps working from there; it's an ordinary step, so **Undo** returns to where you were.  Versions that reached the TV are marked *sent to the TV*.  Each version holds only your edits (which groups and channels are hidden, renames, your groups and so on), not the channel list, so it's small: a few KB for a typical clean-up, about 200 KB for 12,000 changes on a 15,000-channel playlist.  The TV keeps up to 8 MB of draft history per playlist (40 automatic versions and 25 others), drops the oldest automatic ones first, and deletes a playlist's drafts with the playlist.

---

← [Turning on the web editor](Turning-on-the-web-editor)  ·  [Home](Home)  ·  [Groups and channels](Groups-and-channels) →
