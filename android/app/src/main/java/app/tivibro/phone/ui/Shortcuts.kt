/* The shortcuts on each TV's card on the home screen, and which ones this TV can use: On now needs a
   TMDB token on the TV, Movies and Shows a provider that has them, My media a media source.  Kept apart
   from the drawing (HomeScreen.kt) so it can be tested. */
package app.tivibro.phone.ui

import app.tivibro.phone.proto.NowState

enum class Shortcut(val label: String) {
    REMOTE("Remote"), GUIDE("Guide"), ON_NOW("On now"), VOD("Movies and Shows"), MEDIA("My media"),
    REMINDERS("Reminders"), EDITOR("Edit channels"), BACKUPS("Backups"), SETTINGS("Settings");

    companion object {
        /** What the TV said it has ([caps] null: not known yet, so only the ones every TV has, plus Movies and Shows). */
        fun forTv(caps: NowState?): List<Shortcut> = entries.filter { s ->
            when (s) {
                ON_NOW -> caps?.onnow == true
                VOD -> caps?.movies != false || caps?.series != false
                MEDIA -> caps?.media == true
                else -> true
            }
        }

        /** The tab of the TV screen a shortcut opens (TvScreen's tab names), or null for its own screen. */
        fun tab(s: Shortcut, caps: NowState?): String? = when (s) {
            REMOTE -> "Remote"
            GUIDE -> "Guide"
            ON_NOW -> "On now"
            VOD -> if (caps?.movies == false && caps?.series != false) "Shows" else "Movies"
            MEDIA -> "My media"
            SETTINGS -> "Settings"
            else -> null
        }
    }
}
