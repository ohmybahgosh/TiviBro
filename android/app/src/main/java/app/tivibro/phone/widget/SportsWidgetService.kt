/* The Sports widget's rows, from the worker's cache.  A live game is a Spotlight (big, in both teams' colours: logos,
   the score, the clock, where the ball is, Watch on TV with the TV's channel), every live game so, even when the widget
   then scrolls; with none live, the next game is.  The rest are one line each: the followed team's logo, "Michigan vs
   Miami" (or the final score), the league and channel, and when.  Tapping either fills in the team for SportsWidget's
   PLAY. */
package app.tivibro.phone.widget

import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import app.tivibro.phone.I18n
import app.tivibro.phone.R
import app.tivibro.phone.tr

class SportsWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Rows(applicationContext)
}

/** Colours for the widget from ESPN's team colours.  Pure, for tests. */
object TeamColors {
    private const val BASE = 0x10142A
    fun parse(hex: String): Int? = hex.removePrefix("#").takeIf { it.length == 6 }?.toIntOrNull(16)
    // Relative brightness, 0 (black) to 1 (white).
    fun lum(c: Int): Double { val r = (c shr 16 and 255) / 255.0; val g = (c shr 8 and 255) / 255.0; val b = (c and 255) / 255.0; return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    private fun grey(c: Int): Boolean { val r = c shr 16 and 255; val g = c shr 8 and 255; val b = c and 255; return maxOf(r, g, b) - minOf(r, g, b) < 24 }
    fun mix(a: Int, b: Int, t: Double): Int {
        fun ch(s: Int) = ((a shr s and 255) * (1 - t) + (b shr s and 255) * t).toInt().coerceIn(0, 255)
        return (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }
    /** A team's colour that shows on the dark widget: its own, or its second one when its own is near black (the
     *  Bears' navy: their orange), else its own lightened.  0xRRGGBB. */
    fun team(color: String, alt: String): Int {
        val c = parse(color) ?: return 0x5B8CFF
        if (lum(c) >= 0.12) return c
        val a = parse(alt)
        if (a != null && !grey(a) && lum(a) > lum(c)) return a
        return mix(c, 0xFFFFFF, 0.3)
    }
    /** A Spotlight's card: the team's colour sunk into the widget's ink, dark enough for white text. */
    fun card(team: Int): Int = mix(BASE, team, 0.32).let { if (lum(it) > 0.2) mix(it, 0, 0.4) else it }
}

private class Rows(private val ctx: Context) : RemoteViewsService.RemoteViewsFactory {
    private var games: List<WGame> = emptyList()
    private var spot: Set<String> = emptySet()
    private var chans: Map<String, String> = emptyMap()

    override fun onCreate() {}
    override fun onDataSetChanged() {
        I18n.ensure(ctx)
        games = Cache.games(ctx)
        // Every live game is a Spotlight; with none live, the first (next) one.
        spot = games.filter { it.live }.map { it.id }.toSet().ifEmpty { games.firstOrNull { it.state == "pre" }?.let { setOf(it.id) } ?: emptySet() }
        chans = MyTeams.channels(ctx)
    }
    override fun onDestroy() {}
    override fun getCount() = games.size
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 2
    override fun getItemId(position: Int) = games.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()
    override fun hasStableIds() = true

    override fun getViewAt(position: Int): RemoteViews {
        val g = games[position]
        val v = if (g.id in spot) spotlight(g) else line(g)
        val what = tr("{x} at {y}", "x" to g.away.name, "y" to g.home.name)
        val fill = Intent().putExtra("team", g.team).putExtra("what", what)
        v.setOnClickFillInIntent(if (g.id in spot) R.id.sp_root else R.id.swr_root, fill)
        if (g.id in spot) v.setOnClickFillInIntent(R.id.sp_watch, fill)
        return v
    }

    private fun channel(g: WGame) = chans[g.id].orEmpty().ifBlank { g.net }

    // The big one.
    private fun spotlight(g: WGame): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_sports_spot)
        val awayC = TeamColors.team(g.away.color, g.away.alt); val homeC = TeamColors.team(g.home.color, g.home.alt)
        val mineC = if (g.home.mine) homeC else awayC
        if (Build.VERSION.SDK_INT >= 31) {
            v.setColorStateList(R.id.sp_root, "setBackgroundTintList", ColorStateList.valueOf(0xFF000000.toInt() or TeamColors.card(mineC)))
            v.setColorStateList(R.id.sp_stripe_away, "setBackgroundTintList", ColorStateList.valueOf(0xFF000000.toInt() or awayC))
            v.setColorStateList(R.id.sp_stripe_home, "setBackgroundTintList", ColorStateList.valueOf(0xFF000000.toInt() or homeC))
        } else {
            v.setInt(R.id.sp_stripe_away, "setBackgroundColor", 0xFF000000.toInt() or awayC)
            v.setInt(R.id.sp_stripe_home, "setBackgroundColor", 0xFF000000.toInt() or homeC)
        }
        v.setTextViewText(R.id.sp_league, g.lg.uppercase())
        v.setTextViewText(R.id.sp_pill, if (g.live) tr("Live").uppercase() else tr("Next").uppercase())
        if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(R.id.sp_pill, "setBackgroundTintList", ColorStateList.valueOf(if (g.live) 0xFFE5484D.toInt() else 0xFF5B8CFF.toInt()))
        logo(v, R.id.sp_away_logo, g.away); logo(v, R.id.sp_home_logo, g.home)
        v.setTextViewText(R.id.sp_away_name, name(g.away)); v.setTextViewText(R.id.sp_home_name, name(g.home))
        val started = g.state != "pre"
        if (started) {
            val a = g.away.score?.toIntOrNull(); val h = g.home.score?.toIntOrNull()
            v.setTextViewText(R.id.sp_away_score, g.away.score.orEmpty()); v.setTextViewText(R.id.sp_home_score, g.home.score.orEmpty())
            // The side behind is dimmed.
            v.setTextColor(R.id.sp_away_score, if (a != null && h != null && a < h) 0xFF8A93A8.toInt() else Color.WHITE)
            v.setTextColor(R.id.sp_home_score, if (a != null && h != null && h < a) 0xFF8A93A8.toInt() else Color.WHITE)
            v.setTextViewText(R.id.sp_mid, "–")
            v.setTextViewTextSize(R.id.sp_mid, android.util.TypedValue.COMPLEX_UNIT_SP, 30f)
        } else {
            v.setTextViewText(R.id.sp_away_score, ""); v.setTextViewText(R.id.sp_home_score, "")
            v.setTextViewText(R.id.sp_mid, when_(g, short = true))
            v.setTextViewTextSize(R.id.sp_mid, android.util.TypedValue.COMPLEX_UNIT_SP, 26f)
            v.setTextColor(R.id.sp_mid, Color.WHITE)
        }
        v.setTextViewText(R.id.sp_state, if (g.live) g.detail else when_(g, short = false))
        v.setTextColor(R.id.sp_state, if (g.live) 0xFFFF8F8F.toInt() else 0xFFC9D1E3.toInt())
        v.setTextViewText(R.id.sp_sit, g.sit)
        v.setViewVisibility(R.id.sp_sit, if (g.sit.isBlank()) android.view.View.GONE else android.view.View.VISIBLE)
        val ch = channel(g)
        v.setTextViewText(R.id.sp_watch, "▶  " + tr("Watch on TV") + if (ch.isNotBlank()) " · $ch" else "")
        return v
    }

    // One line.
    private fun line(g: WGame): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_sports_row)
        logo(v, R.id.swr_logo, g.mine)
        val ms = g.mine.score; val os = g.other.score
        val title: CharSequence = if (g.state == "post" && ms != null && os != null) {
            val s = SpannableString("${g.mine.name} $ms  ·  ${g.other.name} $os")
            s.setSpan(StyleSpan(Typeface.BOLD), 0, g.mine.name.length + 1 + ms.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE); s
        } else {
            val txt = if (g.home.mine) tr("{x} vs {y}", "x" to g.mine.name, "y" to g.other.name) else tr("{x} at {y}", "x" to g.mine.name, "y" to g.other.name)
            SpannableString(txt).also { s -> val i = txt.indexOf(g.mine.name); if (i >= 0) s.setSpan(StyleSpan(Typeface.BOLD), i, i + g.mine.name.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        }
        v.setTextViewText(R.id.swr_title, title)
        v.setTextViewText(R.id.swr_sub, listOf(g.lg.uppercase(), channel(g)).filter { it.isNotBlank() }.joinToString("  ·  "))
        if (g.state == "post") {
            val a = g.mine.score?.toIntOrNull(); val b = g.other.score?.toIntOrNull()
            val won = a != null && b != null && a > b; val lost = a != null && b != null && a < b
            val t = SpannableString(tr("Final"))
            if (won || lost) t.setSpan(ForegroundColorSpan(if (won) 0xFF4CC38A.toInt() else 0xFFFF6B6B.toInt()), 0, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            v.setTextViewText(R.id.swr_when, t)
        } else v.setTextViewText(R.id.swr_when, when_(g, short = false))
        return v
    }

    private fun name(t: WTeam): CharSequence = SpannableString(t.name.ifBlank { t.abbr }).also { if (t.mine) it.setSpan(StyleSpan(Typeface.BOLD), 0, it.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }

    private fun logo(v: RemoteViews, id: Int, t: WTeam) {
        val b = SportsWidgetWorker.logoBitmap(ctx, t.logo)
        if (b != null) v.setImageViewBitmap(id, b) else v.setImageViewResource(id, R.drawable.ic_tile)
    }

    // When a game starts: "3:30 PM" today, "Fri 3:00 PM" this week; [short]: the time alone today.
    private fun when_(g: WGame, short: Boolean): String {
        val d = java.util.Date(g.start)
        val time = android.text.format.DateFormat.getTimeFormat(ctx).format(d)
        val today = android.text.format.DateUtils.isToday(g.start)
        if (today) return if (short) time else tr("Today {x}", "x" to time)
        return java.text.SimpleDateFormat("EEE", java.util.Locale.getDefault()).format(d) + " " + time
    }
}
