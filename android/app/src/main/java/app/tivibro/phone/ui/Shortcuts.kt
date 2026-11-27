/* The shortcuts on each TV's card on the home screen, and which ones this TV can use: Sports needs a TV
   new enough to have it, On now a TMDB token on the TV, Movies and Shows a provider that has them, My media a media source, Plex a Plex
   server added on the TV, Recordings a USB
   drive in the TV (or recordings on one).  Kept apart
   from the drawing (HomeScreen.kt) so it can be tested. */
package app.tivibro.phone.ui

import app.tivibro.phone.tr

import app.tivibro.phone.proto.NowState

enum class Shortcut(val label: String) {
    REMOTE(tr("Remote")), GUIDE(tr("Guide")), SPORTS(tr("Sports")), ON_NOW(tr("On now")), VOD(tr("Movies and Shows")), MEDIA(tr("My media")), PLEX("Plex"),
    REMINDERS(tr("Reminders")), RECORDINGS(tr("Recordings")), EDITOR(tr("Edit channels")), BACKUPS(tr("Backups")), SETTINGS(tr("Settings"));

    companion object {
        /** What the TV said it has ([caps] null: not known yet, so only the ones every TV has, plus Movies and Shows). */
        fun forTv(caps: NowState?): List<Shortcut> = entries.filter { s ->
            when (s) {
                SPORTS -> caps?.sports == true
                ON_NOW -> caps?.onnow == true
                VOD -> caps?.movies != false || caps?.series != false
                MEDIA -> caps?.media == true
                PLEX -> caps?.plex == true
                RECORDINGS -> caps?.rec == true
                else -> true
            }
        }

        /** The tab of the TV screen a shortcut opens (TvScreen's tab names), or null for its own screen. */
        fun tab(s: Shortcut, caps: NowState?): String? = when (s) {
            REMOTE -> tr("Remote")
            GUIDE -> tr("Guide")
            SPORTS -> tr("Sports")
            ON_NOW -> tr("On now")
            VOD -> if (caps?.movies == false && caps?.series != false) tr("Shows") else tr("Movies")
            MEDIA -> tr("My media")
            PLEX -> "Plex"
            SETTINGS -> tr("Settings")
            else -> null
        }
    }
}
