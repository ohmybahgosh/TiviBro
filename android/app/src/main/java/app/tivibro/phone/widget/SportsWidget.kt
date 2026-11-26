/* The Sports widget: the games of the teams the TV follows (My teams), live ones first with their score, then the
   next ones and today's results.  Any size from a strip to the whole page (Android's widget resizing).  Tapping a
   game plays it on the TV (turned on first when it can be), its channels tried in turn as the TV's launcher links
   do; the title opens the app, the arrow refreshes.  Filled by SportsWidgetWorker; drawn from its cache. */
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
            PLAY -> play(ctx.applicationContext, i.getStringExtra("team").orEmpty(), i.getStringExtra("what").orEmpty())
        }
    }

    // A game tapped: played on the TV picked in the app (or the only one), in TvReach's scope (a receiver is let go of within seconds).
    private fun play(app: Context, team: String, what: String) {
        val tv = TvStore(app).tileChoice()
        if (tv == null) { Toast.makeText(app, tr("Pair a TV in the app"), Toast.LENGTH_LONG).show(); return }
        if (team.isBlank()) return
        Toast.makeText(app, tr("Putting {x} on {y}…", "x" to what, "y" to tv.name), Toast.LENGTH_SHORT).show()
        TvReach.scope.launch {
            val msg = if (!TvReach.up(app, tv)) tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name)
            else try { TvClient(tv, 15_000).playTeam(team); tr("Playing {x} on {y}", "x" to what, "y" to tv.name) }
            catch (e: TbException) { if (e.code == "bad") tr("Update TiviBro on {x} to play games from the widget.", "x" to tv.name) else e.message ?: tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name) }
            catch (e: Exception) { tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name) }
            withContext(Dispatchers.Main) { Toast.makeText(app, msg, Toast.LENGTH_LONG).show() }
        }
    }

    companion object {
        const val REFRESH = "app.tivibro.phone.WIDGET_REFRESH"
        const val PLAY = "app.tivibro.phone.WIDGET_PLAY"

        /** Every Sports widget drawn again from the cache (after the worker read new scores). */
        fun drawAll(ctx: Context) {
            val wm = AppWidgetManager.getInstance(ctx)
            val ids = wm.getAppWidgetIds(ComponentName(ctx, SportsWidget::class.java))
            ids.forEach { draw(ctx, wm, it) }
            @Suppress("DEPRECATION") wm.notifyAppWidgetViewDataChanged(ids, R.id.sw_list)
        }

        private fun draw(ctx: Context, wm: AppWidgetManager, id: Int) {
            I18n.ensure(ctx)
            val v = RemoteViews(ctx.packageName, R.layout.widget_sports)
            v.setTextViewText(R.id.sw_title, tr("My teams"))
            val at = Cache.at(ctx)
            v.setTextViewText(R.id.sw_when, if (at > 0) android.text.format.DateFormat.getTimeFormat(ctx).format(java.util.Date(at)) else "")
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
            v.setPendingIntentTemplate(R.id.sw_list, PendingIntent.getBroadcast(ctx, 1, Intent(ctx, SportsWidget::class.java).setAction(PLAY),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
            v.setOnClickPendingIntent(R.id.sw_title, PendingIntent.getActivity(ctx, 2, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
            v.setOnClickPendingIntent(R.id.sw_refresh, PendingIntent.getBroadcast(ctx, 3, Intent(ctx, SportsWidget::class.java).setAction(REFRESH), PendingIntent.FLAG_IMMUTABLE))
            wm.updateAppWidget(id, v)
        }
    }
}
