/* The Sports widget: the games of the teams the TV follows (My teams), live ones first with their score, then the
   next ones and today's results.  Any size from a strip to the whole page (Android's widget resizing).  Tapping a
   game opens its inner card (more about it: GameDetail) with a back arrow to the list; Watch on TV plays it on the
   TV (turned on first when it can be), its channels tried in turn as the TV's launcher links do, or the channel
   picked in the inner card.  The title opens the app, the arrow refreshes.  Filled by SportsWidgetWorker; drawn from
   its cache. */
package app.tivibro.phone.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import android.widget.Toast
import app.tivibro.phone.I18n
import app.tivibro.phone.MainActivity
import app.tivibro.phone.R
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.TbException
import app.tivibro.phone.proto.TvClient
import app.tivibro.phone.tr
import app.tivibro.phone.work.TvReach
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SportsWidget : AppWidgetProvider() {
    override fun onEnabled(ctx: Context) = SportsWidgetWorker.start(ctx)
    override fun onDisabled(ctx: Context) = SportsWidgetWorker.stop(ctx)

    override fun onUpdate(ctx: Context, wm: AppWidgetManager, ids: IntArray) {
        ids.forEach { draw(ctx, wm, it) }
        SportsWidgetWorker.start(ctx)
    }

    override fun onReceive(ctx: Context, i: Intent) {
        super.onReceive(ctx, i)
        I18n.ensure(ctx)
        when (i.action) {
            REFRESH -> { Toast.makeText(ctx, tr("Getting the scores…"), Toast.LENGTH_SHORT).show(); SportsWidgetWorker.now(ctx) }
            PLAY -> {
                val widget = i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0)
                val app = ctx.applicationContext
                when {
                    i.hasExtra("back") -> { DetailOpen.close(app, widget); drawAll(app) }
                    i.hasExtra("open") -> open(app, widget, i.getStringExtra("open").orEmpty())
                    i.hasExtra("url") -> link(app, i.getStringExtra("url").orEmpty())
                    else -> play(app, i.getStringExtra("team").orEmpty(), i.getStringExtra("what").orEmpty(), i.getStringExtra("k").orEmpty())
                }
            }
            BACK -> { DetailOpen.close(ctx, i.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0)); drawAll(ctx) }
        }
    }

    // A game tapped: its inner card at once (with what was read before, or "Getting the game's details"), then ESPN's
    // summary read and drawn.
    private fun open(app: Context, widget: Int, game: String) {
        if (game.isBlank()) return
        DetailOpen.open(app, widget, game)
        drawAll(app)
        val g = Cache.games(app).firstOrNull { it.id == game } ?: return
        TvReach.scope.launch { GameDetail.fetch(app, g); GameDetail.tidy(app); withContext(Dispatchers.Main) { drawAll(app) } }
    }

    // A highlight: ESPN's page for it, in the browser.
    private fun link(app: Context, url: String) {
        if (!url.startsWith("https://")) return
        runCatching { app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { Toast.makeText(app, tr("Couldn't open that"), Toast.LENGTH_SHORT).show() }
    }

    // A game tapped: played on the TV picked in the app (or the only one), in TvReach's scope (a receiver is let go of within seconds).
    // [k]: a channel picked in the inner card, played as it is; otherwise the team's game, its channels tried in turn.
    private fun play(app: Context, team: String, what: String, k: String = "") {
        val tv = TvStore(app).tileChoice()
        if (tv == null) { Toast.makeText(app, tr("Pair a TV in the app"), Toast.LENGTH_LONG).show(); return }
        if (team.isBlank() && k.isBlank()) return
        Toast.makeText(app, tr("Putting {x} on {y}…", "x" to what, "y" to tv.name), Toast.LENGTH_SHORT).show()
        TvReach.scope.launch {
            val msg = if (!TvReach.up(app, tv)) tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name)
            else try { if (k.isNotBlank()) TvClient(tv, 15_000).play(k) else TvClient(tv, 15_000).playTeam(team); tr("Playing {x} on {y}", "x" to what, "y" to tv.name) }
            catch (e: TbException) { if (e.code == "bad") tr("Update TiviBro on {x} to play games from the widget.", "x" to tv.name) else e.message ?: tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name) }
            catch (e: Exception) { tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name) }
            withContext(Dispatchers.Main) { Toast.makeText(app, msg, Toast.LENGTH_LONG).show() }
        }
    }

    companion object {
        const val REFRESH = "app.tivibro.phone.WIDGET_REFRESH"
        const val PLAY = "app.tivibro.phone.WIDGET_PLAY"
        const val BACK = "app.tivibro.phone.WIDGET_BACK"

        /** Every Sports widget drawn again from the cache (after the worker read new scores). */
        fun drawAll(ctx: Context) {
            val wm = AppWidgetManager.getInstance(ctx)
            val ids = wm.getAppWidgetIds(ComponentName(ctx, SportsWidget::class.java))
            // One widget that fails to draw (logged) mustn't keep the others, or the list, from updating.
            ids.forEach { id -> runCatching { draw(ctx, wm, id) }.onFailure { android.util.Log.w("TiviBroWidget", "Sports widget $id: ${it.message}") } }
            @Suppress("DEPRECATION") wm.notifyAppWidgetViewDataChanged(ids, R.id.sw_list)
        }

        private fun draw(ctx: Context, wm: AppWidgetManager, id: Int) {
            I18n.ensure(ctx)
            val v = RemoteViews(ctx.packageName, R.layout.widget_sports)
            // A game's inner card open: its name in the title, with a back arrow to the list.
            val open = DetailOpen.of(ctx, id)?.let { g -> Cache.games(ctx).firstOrNull { it.id == g } }
            v.setTextViewText(R.id.sw_title, open?.let { tr("{x} at {y}", "x" to it.away.name, "y" to it.home.name) } ?: tr("My teams"))
            v.setViewVisibility(R.id.sw_back, if (open != null) android.view.View.VISIBLE else android.view.View.GONE)
            v.setViewVisibility(R.id.sw_logo, if (open != null) android.view.View.GONE else android.view.View.VISIBLE)
            val back = PendingIntent.getBroadcast(ctx, 1000 + id, Intent(ctx, SportsWidget::class.java).setAction(BACK).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            v.setOnClickPendingIntent(R.id.sw_back, back)
            val at = Cache.at(ctx)
            // When the scores were read, only once they are getting old (the phone offline, or Android holding the
            // refresh back): a time that sits there looked like part of the scores.
            val old = at > 0 && System.currentTimeMillis() - at > 20 * 60_000L
            v.setTextViewText(R.id.sw_when, if (old) tr("Updated {x}", "x" to android.text.format.DateFormat.getTimeFormat(ctx).format(java.util.Date(at))) else "")
            v.setTextViewText(R.id.sw_empty, when {
                MyTeams.all(ctx).isEmpty() -> tr("Follow teams in My teams on the TV, then open the app's Sports tab once.")
                at == 0L -> tr("Getting the scores…")
                else -> tr("No games this week")
            })
            // The list: one row per game, from SportsWidgetService.  Its own URI per widget, so each keeps its own list.
            val svc = Intent(ctx, SportsWidgetService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
            @Suppress("DEPRECATION") v.setRemoteAdapter(R.id.sw_list, svc)
            v.setEmptyView(R.id.sw_list, R.id.sw_empty)
            // One per widget (its id in it), so a game opens in the widget it was tapped in.
            v.setPendingIntentTemplate(R.id.sw_list, PendingIntent.getBroadcast(ctx, 2000 + id, Intent(ctx, SportsWidget::class.java).setAction(PLAY).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
            v.setOnClickPendingIntent(R.id.sw_title, if (open != null) back else PendingIntent.getActivity(ctx, 2, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
            v.setOnClickPendingIntent(R.id.sw_refresh, PendingIntent.getBroadcast(ctx, 3, Intent(ctx, SportsWidget::class.java).setAction(REFRESH), PendingIntent.FLAG_IMMUTABLE))
            wm.updateAppWidget(id, v)
        }
    }
}
