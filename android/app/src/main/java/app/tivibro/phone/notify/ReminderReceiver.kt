/* The reminders' alarms and buttons (PhoneReminders): FIRE shows the notification, WATCH (its Watch on TV) turns the
   TV on when it can and plays the programme there.  Not exported: only the app's own alarms and notifications reach it.
   After the phone restarts (or the app is updated) ReminderBoot sets the alarms again, since Android forgets them. */
package app.tivibro.phone.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import app.tivibro.phone.I18n
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.TvClient
import app.tivibro.phone.tr
import app.tivibro.phone.work.TvReach
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        I18n.ensure(ctx)
        val r = i.getStringExtra("r")?.let { runCatching { PhoneReminder.from(JSONObject(it)) }.getOrNull() }
        when (i.action) {
            FIRE -> if (r != null) PhoneReminders.show(ctx, r)
            WATCH -> if (r != null) watch(ctx.applicationContext, r)
        }
    }

    // Watch on TV: in TvReach's scope (a receiver is let go of within seconds), with a toast when it's done or can't be.
    private fun watch(app: Context, r: PhoneReminder) {
        PhoneReminders.dismiss(app, r)
        val tv = TvStore(app).load().firstOrNull { it.id == r.tv }
        if (tv == null) { Toast.makeText(app, tr("That TV isn't paired with this phone any more."), Toast.LENGTH_LONG).show(); return }
        Toast.makeText(app, tr("Turning to {x} on {y}…", "x" to r.channel, "y" to tv.name), Toast.LENGTH_SHORT).show()
        TvReach.scope.launch {
            val ok = TvReach.up(app, tv) && runCatching { TvClient(tv, 15_000).playShow(r.k, r.start) }.isSuccess
            withContext(Dispatchers.Main) {
                Toast.makeText(app, if (ok) tr("Playing {x} on {y}", "x" to r.channel, "y" to tv.name) else tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name), Toast.LENGTH_LONG).show()
            }
        }
    }

    companion object {
        const val FIRE = "app.tivibro.phone.REMINDER_FIRE"
        const val WATCH = "app.tivibro.phone.REMINDER_WATCH"
    }
}

/** Android forgot the alarms (the phone restarted, or the app was updated): set them again. */
class ReminderBoot : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        if (i.action == Intent.ACTION_BOOT_COMPLETED || i.action == Intent.ACTION_MY_PACKAGE_REPLACED) PhoneReminders.reschedule(ctx)
    }
}
