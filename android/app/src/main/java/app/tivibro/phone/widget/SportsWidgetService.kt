/* The Sports widget's rows (one per game, from the worker's cache): the league, each team's logo, short name and score,
   and how the game stands ("● 2nd 12:31" live, "Final", or when it starts).  A followed team's name is bold.  Tapping
   a row fills in the team for SportsWidget's PLAY. */
package app.tivibro.phone.widget

import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StyleSpan
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import app.tivibro.phone.I18n
import app.tivibro.phone.R
import app.tivibro.phone.tr

class SportsWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Rows(applicationContext)
}

private class Rows(private val ctx: Context) : RemoteViewsService.RemoteViewsFactory {
    private var games: List<WGame> = emptyList()
    override fun onCreate() {}
    override fun onDataSetChanged() { I18n.ensure(ctx); games = Cache.games(ctx) }
    override fun onDestroy() {}
    override fun getCount() = games.size
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 1
    override fun getItemId(position: Int) = games.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()
    override fun hasStableIds() = true

    override fun getViewAt(position: Int): RemoteViews {
        val g = games[position]
        val v = RemoteViews(ctx.packageName, R.layout.widget_sports_row)
        v.setTextViewText(R.id.swr_league, g.lg.uppercase())
        side(v, g, g.away, R.id.swr_away_logo, R.id.swr_away, R.id.swr_away_score)
        side(v, g, g.home, R.id.swr_home_logo, R.id.swr_home, R.id.swr_home_score)
        v.setTextViewText(R.id.swr_state, state(g))
        v.setTextColor(R.id.swr_state, if (g.live) 0xFFFF5A5A.toInt() else 0xFFB8C0D0.toInt())
        val name = tr("{x} at {y}", "x" to g.away.name, "y" to g.home.name)
        v.setOnClickFillInIntent(R.id.swr_root, Intent().putExtra("team", g.team).putExtra("what", name))
        return v
    }

    // One team: its logo (kept by the worker), name (bold when followed) and, once the game started, its score.
    private fun side(v: RemoteViews, g: WGame, t: WTeam, logo: Int, name: Int, score: Int) {
        val b = SportsWidgetWorker.logoBitmap(ctx, t.logo)
        if (b != null) v.setImageViewBitmap(logo, b) else v.setImageViewResource(logo, R.drawable.ic_tile)
        val n = SpannableString(t.name.ifBlank { t.abbr })
        if (t.mine) n.setSpan(StyleSpan(Typeface.BOLD), 0, n.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        v.setTextViewText(name, n)
        v.setTextViewText(score, if (g.state == "pre") "" else t.score.orEmpty())
    }

    // How the game stands: live with ESPN's clock, final, or its day and time.
    private fun state(g: WGame): String = when (g.state) {
        "in" -> "● " + g.detail
        "post" -> g.detail.ifBlank { tr("Final") }
        else -> {
            val d = java.util.Date(g.start)
            val today = android.text.format.DateUtils.isToday(g.start)
            val time = android.text.format.DateFormat.getTimeFormat(ctx).format(d)
            if (today) time else java.text.SimpleDateFormat("EEE", java.util.Locale.getDefault()).format(d) + " " + time
        }
    }
}
