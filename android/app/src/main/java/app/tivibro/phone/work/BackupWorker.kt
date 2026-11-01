/* Automatic backups: about twice a day on Wi-Fi, Android lets this check each paired TV.  A TV whose last
   backup is a week old gets a new one, but only when the TV is on and TiviBro is already open on it
   (noOpen: TiviBro is never opened over something else just to back it up).  Off in the app's Backups
   screen. */
package app.tivibro.phone.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.tivibro.phone.data.BackupStore
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.Pairing
import app.tivibro.phone.proto.TvClient
import java.util.concurrent.TimeUnit

class BackupWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val store = BackupStore(applicationContext)
        if (!store.auto) return Result.success()
        TvStore(applicationContext).load().forEach { tv ->
            if (!store.due(tv.id)) return@forEach
            runCatching {
                Pairing.hello(tv.host, tv.port, 2500)
                val r = TvClient(tv, 60_000).ask("backup", seal = true, noOpen = true)
                r.optJSONObject("data")?.optJSONObject("backup")?.let { store.save(tv.id, it, auto = true) }
            }
        }
        return Result.success()
    }

    companion object {
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<BackupWorker>(12, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("tivibro-backups", ExistingPeriodicWorkPolicy.KEEP, req)
        }
    }
}
