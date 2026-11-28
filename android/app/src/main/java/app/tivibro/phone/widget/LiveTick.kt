/* The Sports widget's next refresh while a game is live (every minute) or about to start: an alarm rather than
   WorkManager, which Android holds back for hours for an app that isn't opened often (the scores stood still until
   the refresh button).  A plain alarm, not one that wakes the phone: while the screen is off nobody sees the widget,
   and the first one after it comes on brings it up to date.  The refresh runs here, off the main thread, in the few
   seconds a receiver is given (ESPN's per-game feeds are about 1 KB each). */
package app.tivibro.phone.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock

class LiveTick : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val app = ctx.applicationContext
        val done = goAsync()
        Thread {
            try {
                runCatching { SportsWidgetWorker.refresh(app, intent.getBooleanExtra("full", false)) }
                    .onFailure { if (Cache.games(app).any { it.live }) at(app, 60_000L) }   // no network: try again in a minute
            } finally { done.finish() }
        }.start()
    }

    companion object {
        private fun pending(ctx: Context, full: Boolean): PendingIntent =
            PendingIntent.getBroadcast(ctx, 7301, Intent(ctx, LiveTick::class.java).putExtra("full", full),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        /** The next refresh in [ms] (replacing any set before).  [full]: ESPN's scoreboards read in full then. */
        fun at(ctx: Context, ms: Long, full: Boolean = false) {
            val am = ctx.getSystemService(AlarmManager::class.java) ?: return
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + ms, pending(ctx, full))
        }
        /** Nothing live or about to start, or the last widget went. */
        fun cancel(ctx: Context) { ctx.getSystemService(AlarmManager::class.java)?.cancel(pending(ctx, false)) }
    }
}
