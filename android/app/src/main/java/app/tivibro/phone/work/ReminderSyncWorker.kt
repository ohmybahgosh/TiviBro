/* Keeps the phone's reminder notifications (notify/PhoneReminders.kt) in step with each paired TV: about every 15
   minutes on any network, each TV that answers is asked for its reminders.  The TV's helper answers even with TiviBro
   closed (from TiviBro 224; an older one says it's closed, and the list stays as it was).  TiviBro is never opened
   for this.  A TV that doesn't answer (off, or the phone away from home) keeps the reminders it last gave. */
package app.tivibro.phone.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.notify.PhoneReminders
import app.tivibro.phone.proto.Pairing
import app.tivibro.phone.proto.Reminder
import app.tivibro.phone.proto.TvClient
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ReminderSyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext
        if (!PhoneReminders.on(app)) return Result.success()
        TvStore(app).load().forEach { tv ->
            runCatching {
                Pairing.hello(tv.host, tv.port, 2000)
                val r = TvClient(tv, 15_000).ask("reminders", JSONObject().put("op", "list"), noOpen = true)
                val data = r.optJSONObject("data")
                if (r.optBoolean("closed") || data == null) return@runCatching
                PhoneReminders.update(app, tv, Reminder.list(data))
            }
        }
        PhoneReminders.reschedule(app)
        return Result.success()
    }

    companion object {
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<ReminderSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("tivibro-reminders", ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
