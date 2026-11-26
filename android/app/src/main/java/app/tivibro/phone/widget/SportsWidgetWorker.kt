/* Fills the Sports widget: the followed teams' games from ESPN (Scores), their logos kept on the phone, then every
   Sports widget drawn again.  A full read about every 15 minutes while a widget is on the home screen; while one of
   the games is live, its score and clock every minute from ESPN's small per-game feeds.  When the phone doesn't know the TV's teams yet, the TV is asked (only if TiviBro is open
   on it: it is never opened for this). */
package app.tivibro.phone.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.SportsList
import app.tivibro.phone.proto.TvClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class SportsWidgetWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext
        if (ids(app).isEmpty()) return Result.success()
        if (MyTeams.all(app).isEmpty()) learnFromTv(app)
        val teams = MyTeams.all(app)
        val now = System.currentTimeMillis()
        val before = Cache.games(app)
        // Between full reads (every 15 minutes, or when asked), live games are brought up to date from ESPN's small
        // per-game feeds (Scores.refreshLive).  A full read when a game should have started, or one just ended.
        val full = inputData.getBoolean("full", false) || now - Cache.fullAt(app) > 14 * 60_000L || before.none { it.live } ||
            before.any { it.state == "pre" && it.start <= now }
        val games = when {
            teams.isEmpty() -> emptyList()
            full -> Scores.fetch(teams).take(12)
            else -> Scores.order(before.map { g -> if (g.live) Scores.refreshLive(g) ?: g else g })
        }
        games.flatMap { listOf(it.away.logo, it.home.logo) }.distinct().forEach { logo(app, it) }
        Cache.save(app, games, full)
        // An open inner card: its summary again every two minutes while the game is live (it's about 400 KB).
        DetailOpen.all(app).forEach { id -> games.firstOrNull { it.id == id }?.let { g ->
            val d = GameDetail.cached(app, id)
            if (d == null || inputData.getBoolean("full", false) || (g.live && now - d.at > 110_000L)) GameDetail.fetch(app, g)
        } }
        SportsWidget.drawAll(app)
        // Live: again in a minute (WorkManager's periodic work can't run more often than every 15); a game that just
        // ended gets a full read then too.  A game about to start: around its start.
        when {
            games.any { it.live } -> soon(app, 1, full = before.any { b -> b.live && games.none { it.id == b.id && it.live } })
            games.any { it.state == "pre" && it.start - now in 0..15 * 60_000L } -> soon(app, 5, full = true)
        }
        return Result.success()
    }

    // The TV's followed teams, from its Sports, when TiviBro is open on it (never opened for this).
    private fun learnFromTv(app: Context) {
        val tv = TvStore(app).tileChoice() ?: return
        runCatching {
            val r = TvClient(tv, 20_000).ask("sports", JSONObject().put("op", "list"), noOpen = true)
            r.optJSONObject("data")?.let { MyTeams.learn(app, SportsList.from(it)) }
        }
    }

    companion object {
        private const val EVERY = "tivibro-sports-widget"
        private const val SOON = "tivibro-sports-widget-soon"
        private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun ids(ctx: Context): IntArray = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, SportsWidget::class.java))

        /** A widget was added: refresh at once and every 15 minutes from now on. */
        fun start(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(EVERY, ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SportsWidgetWorker>(15, TimeUnit.MINUTES).setConstraints(net).build())
            now(ctx)
        }
        /** The last widget went: nothing more to refresh. */
        fun stop(ctx: Context) { WorkManager.getInstance(ctx).cancelUniqueWork(EVERY); WorkManager.getInstance(ctx).cancelUniqueWork(SOON) }
        /** Refresh now, everything (the refresh button, new teams). */
        fun now(ctx: Context) = soon(ctx, 0, full = true)
        private fun soon(ctx: Context, minutes: Long, full: Boolean = false) {
            if (ids(ctx).isEmpty()) return
            WorkManager.getInstance(ctx).enqueueUniqueWork(SOON, ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<SportsWidgetWorker>().setInitialDelay(minutes, TimeUnit.MINUTES).setConstraints(net)
                    .setInputData(androidx.work.workDataOf("full" to full)).build())
        }

        // Team logos, kept small on the phone (RemoteViews carry bitmaps, and a list of them must stay light).
        private fun file(ctx: Context, url: String): File {
            val name = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
            return File(File(ctx.filesDir, "widget-logos-160").apply { mkdirs() }, "$name.png")
        }
        private fun logo(ctx: Context, url: String) {
            if (!url.startsWith("https://")) return
            val f = file(ctx, url)
            if (f.exists()) return
            runCatching {
                val b = URL(url).openStream().use { BitmapFactory.decodeStream(it) } ?: return
                val s = Bitmap.createScaledBitmap(b, 160, 160, true)      // sharp at the Spotlight's 56dp
                f.outputStream().use { s.compress(Bitmap.CompressFormat.PNG, 100, it) }
            }
        }
        /** A logo kept by [logo], or null. */
        fun logoBitmap(ctx: Context, url: String): Bitmap? = file(ctx, url).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }
    }
}

/** The games the widget last read, when, and when ESPN's scoreboards were last read in full. */
object Cache {
    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("sports-widget", Context.MODE_PRIVATE)
    fun save(ctx: Context, l: List<WGame>, full: Boolean = true) {
        val e = prefs(ctx).edit().putString("games", JSONArray().apply { l.forEach { put(it.json()) } }.toString()).putLong("at", System.currentTimeMillis())
        if (full) e.putLong("full", System.currentTimeMillis())
        e.apply()
    }
    fun fullAt(ctx: Context): Long = prefs(ctx).getLong("full", 0)
    fun games(ctx: Context): List<WGame> = runCatching { val a = JSONArray(prefs(ctx).getString("games", "[]")); (0 until a.length()).map { WGame.from(a.getJSONObject(it)) } }.getOrDefault(emptyList())
    fun at(ctx: Context): Long = prefs(ctx).getLong("at", 0)
}
