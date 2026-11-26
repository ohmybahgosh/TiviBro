/* The Sports widget's rows, from the worker's cache.  A live game is a Spotlight (big, in both teams' colours: logos,
   the score, the clock, where the ball is, Watch on TV with the TV's channel), every live game so, even when the widget
   then scrolls; with none live, the next game is.  The rest are one line each: the followed team's logo, "Michigan vs
   Miami" (or the final score), the league and channel, and when.  Tapping a game opens its inner card (SportsWidget
   OPEN); Watch on TV fills in the team for SportsWidget's PLAY.  With a game's inner card open (DetailOpen), the list
   is that game: its Spotlight, Watch on TV with each of its channels, the score by period, the last play and win
   chance, leaders, standings and highlights (GameDetail). */
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
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Rows(applicationContext, intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID, 0))
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

/** One row of the widget's list: a game (in the list, or the head of an inner card), or a part of the inner card. */
private sealed class Item(val key: String) {
    /** [head]: the game at the top of its own card (no Watch on TV: its channels follow). */
    class Game(val g: WGame, val head: Boolean = false) : Item((if (head) "head" else "g") + g.id)
    class Head(val text: String) : Item("h$text")
    class Stat(val label: CharSequence, val value: CharSequence, k: String) : Item("s$k")
    class News(val n: DNews) : Item("n" + n.url)
    class Watch(val g: WGame, val chan: WChan?, val first: Boolean) : Item("w" + (chan?.k ?: "") + (chan?.name ?: ""))
    /** Back to all the games: the inner card's first row, so there's a way back on any launcher. */
    object Back : Item("back")
}

private class Rows(private val ctx: Context, private val widget: Int) : RemoteViewsService.RemoteViewsFactory {
    private var items: List<Item> = emptyList()
    private var spot: Set<String> = emptySet()
    private var chans: Map<String, String> = emptyMap()

    override fun onCreate() {}
    override fun onDataSetChanged() {
        I18n.ensure(ctx)
        val games = Cache.games(ctx)
        chans = MyTeams.channels(ctx)
        val open = DetailOpen.of(ctx, widget)?.let { id -> games.firstOrNull { it.id == id } }
        if (open != null) { spot = setOf(open.id); items = inner(open, GameDetail.cached(ctx, open.id)); return }
        // Every live game is a Spotlight; with none live, the first (next) one.
        spot = games.filter { it.live }.map { it.id }.toSet().ifEmpty { games.firstOrNull { it.state == "pre" }?.let { setOf(it.id) } ?: emptySet() }
        items = games.map { Item.Game(it) }
    }
    override fun onDestroy() {}
    override fun getCount() = items.size
    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 7
    override fun getItemId(position: Int) = items.getOrNull(position)?.key?.hashCode()?.toLong() ?: position.toLong()
    override fun hasStableIds() = true

    override fun getViewAt(position: Int): RemoteViews = when (val it = items[position]) {
        is Item.Game -> game(it.g, it.head)
        is Item.Head -> RemoteViews(ctx.packageName, R.layout.widget_sports_head).apply { setTextViewText(R.id.sh_text, it.text.uppercase()) }
        is Item.Stat -> RemoteViews(ctx.packageName, R.layout.widget_sports_stat).apply { setTextViewText(R.id.st_label, it.label); setTextViewText(R.id.st_value, it.value) }
        is Item.News -> RemoteViews(ctx.packageName, R.layout.widget_sports_news).apply {
            setTextViewText(R.id.nw_mark, if (it.n.video) "▶" else "•"); setTextViewText(R.id.nw_title, it.n.title)
            setOnClickFillInIntent(R.id.nw_root, Intent().putExtra("url", it.n.url))
        }
        is Item.Watch -> watch(it)
        is Item.Back -> RemoteViews(ctx.packageName, R.layout.widget_sports_head).apply {
            setTextViewText(R.id.sh_text, "‹  " + tr("All my teams"))
            setTextViewTextSize(R.id.sh_text, android.util.TypedValue.COMPLEX_UNIT_SP, 18f)
            val dp = ctx.resources.displayMetrics.density; setViewPadding(R.id.sh_text, (8 * dp).toInt(), (10 * dp).toInt(), (8 * dp).toInt(), (10 * dp).toInt())
            setTextColor(R.id.sh_text, 0xFFFFFFFF.toInt())
            setOnClickFillInIntent(R.id.sh_text, Intent().putExtra("back", true))
        }
    }

    // A game in the list (a Spotlight or one line), or the game at the top of its own card.
    private fun game(g: WGame, head: Boolean): RemoteViews {
        val v = if (head || g.id in spot) spotlight(g) else line(g)
        val fill = Intent().putExtra("team", g.team).putExtra("what", what(g))
        if (head) { v.setViewVisibility(R.id.sp_watch, android.view.View.GONE); return v }
        // Anywhere on a game opens its inner card; Watch on TV plays it.
        v.setOnClickFillInIntent(if (g.id in spot) R.id.sp_root else R.id.swr_root, Intent().putExtra("open", g.id))
        if (g.id in spot) v.setOnClickFillInIntent(R.id.sp_watch, fill)
        return v
    }
    private fun what(g: WGame) = tr("{x} at {y}", "x" to g.away.name, "y" to g.home.name)

    // Watch on TV with one channel: the first (best) plays the game with the others tried after it, as the list's
    // Watch does; each other one plays that channel.
    private fun watch(w: Item.Watch): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_sports_watch)
        val name = w.chan?.name.orEmpty()
        v.setTextViewText(R.id.wt_button, if (w.first) "▶  " + tr("Watch on TV") + (if (name.isNotBlank()) " · $name" else "") else "▶  " + tr("Or on {x}", "x" to name))
        if (!w.first) v.setInt(R.id.wt_button, "setBackgroundResource", R.drawable.widget_watch2_bg)
        val fill = Intent().putExtra("team", w.g.team).putExtra("what", what(w.g))
        if (!w.first && !w.chan?.k.isNullOrBlank()) fill.putExtra("k", w.chan!!.k).putExtra("what", name)
        v.setOnClickFillInIntent(R.id.wt_button, fill)
        return v
    }

    /* A game's inner card: its Spotlight, Watch on TV with each channel the TV has it on (before it ends), then what
       ESPN's summary says, or that it's on its way. */
    private fun inner(g: WGame, d: WDetail?): List<Item> {
        /* All in the list, nothing in the widget's own title bar: on a Pixel the launcher sometimes skipped an update of
           the title bar while the list changed, so a title that followed the card got stuck. */
        val out = mutableListOf<Item>(Item.Back, Item.Game(g, head = true))
        if (g.state != "post") {
            val cs = MyTeams.chanLists(ctx)[g.id].orEmpty().ifEmpty { if (g.net.isNotBlank()) listOf(WChan("", g.net)) else emptyList() }
            if (cs.isEmpty()) out.add(Item.Watch(g, null, true))
            cs.forEachIndexed { n, c -> out.add(Item.Watch(g, c, n == 0)) }
        }
        if (d == null) { out.add(Item.Stat(muted(tr("Getting the game's details…")), "", "wait")); return out }
        if (d.lines.any { it.periods.isNotEmpty() }) { out.add(Item.Head(tr("Score by period"))); out.add(Item.Stat(table(d.lines), "", "lines")) }
        if (d.lastPlay.isNotBlank() && g.live) { out.add(Item.Head(tr("Last play"))); out.add(Item.Stat(d.lastPlay, "", "last")) }
        if (d.chance.isNotBlank()) out.add(Item.Stat(tr("Win chance"), d.chance, "chance"))
        if (d.scoring.isNotEmpty()) { out.add(Item.Head(tr("Scoring"))); d.scoring.forEachIndexed { n, x -> out.add(Item.Stat(x, "", "sc$n")) } }
        if (d.leaders.isNotEmpty()) {
            out.add(Item.Head(tr("Leaders")))
            d.leaders.forEachIndexed { n, l -> out.add(Item.Stat(two(l.who, "${l.abbr} · ${l.what}"), l.value, "l$n")) }
        }
        d.standings.forEachIndexed { gi, gr ->
            out.add(Item.Head(gr.name.ifBlank { tr("Standings") }))
            gr.rows.forEachIndexed { n, r ->
                val label: CharSequence = if (r.playing) SpannableString(r.team).also { it.setSpan(StyleSpan(Typeface.BOLD), 0, it.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE); it.setSpan(ForegroundColorSpan(0xFF9FB6FF.toInt()), 0, it.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) } else r.team
                out.add(Item.Stat(label, listOf(r.rec, r.extra).filter { it.isNotBlank() }.joinToString("   "), "st$gi-$n"))
            }
        }
        if (d.news.isNotEmpty()) { out.add(Item.Head(tr("Highlights"))); d.news.forEach { out.add(Item.News(it)) } }
        if (d.venue.isNotBlank()) out.add(Item.Stat(muted(d.venue), "", "venue"))
        return out
    }

    // The score by period as a small monospaced table: a header row of period numbers, then each team.
    private fun table(lines: List<DLine>): CharSequence {
        val n = lines.maxOf { it.periods.size }
        val w = maxOf(2, lines.flatMap { it.periods + it.score }.maxOf { it.length })
        val aw = lines.maxOf { it.abbr.length }
        fun cell(x: String) = x.padStart(w + 1)
        val head = "".padEnd(aw) + (1..n).joinToString("") { cell("$it") } + cell("T")
        val body = lines.map { l -> l.abbr.padEnd(aw) + (0 until n).joinToString("") { cell(l.periods.getOrElse(it) { "" }) } + cell(l.score) }
        val txt = (listOf(head) + body).joinToString("\n")
        return SpannableString(txt).also {
            it.setSpan(android.text.style.TypefaceSpan("monospace"), 0, txt.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            it.setSpan(ForegroundColorSpan(0xFF8A93A8.toInt()), 0, head.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }
    // A name over a quieter line ("J. Goff" over "DET · Passing Yards").
    private fun two(top: String, under: String): CharSequence {
        val s = SpannableString("$top\n$under")
        s.setSpan(StyleSpan(Typeface.BOLD), 0, top.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        s.setSpan(ForegroundColorSpan(0xFF8A93A8.toInt()), top.length + 1, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        s.setSpan(android.text.style.RelativeSizeSpan(0.85f), top.length + 1, s.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        return s
    }
    private fun muted(t: String): CharSequence = SpannableString(t).also { it.setSpan(ForegroundColorSpan(0xFF8A93A8.toInt()), 0, t.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }

    private fun channel(g: WGame) = chans[g.id].orEmpty().ifBlank { g.net }

    // The big one.
    private fun spotlight(g: WGame): RemoteViews =
        RemoteViews(ctx.packageName, R.layout.widget_sports_spot).also { SpotDraw.fill(ctx, it, SpotDraw.LIST, g, channel(g)) }

    // One line.
    private fun line(g: WGame): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_sports_row)
        SpotDraw.logo(ctx, v, R.id.swr_logo, g.mine)
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

    // When a game starts: "3:30 PM" today, "Fri 3:00 PM" this week; [short]: the time alone today.
    private fun when_(g: WGame, short: Boolean): String {
        val d = java.util.Date(g.start)
        val time = android.text.format.DateFormat.getTimeFormat(ctx).format(d)
        val today = android.text.format.DateUtils.isToday(g.start)
        if (today) return if (short) time else tr("Today {x}", "x" to time)
        return java.text.SimpleDateFormat("EEE", java.util.Locale.getDefault()).format(d) + " " + time
    }
}

/* A Spotlight drawn into a RemoteViews (widget_sports_spot.xml, sp_ ids): a live or next game in the list, or the
   game at the top of its own card.  Both teams' colours, logos, names,
   the score or start time, Live / Final / Next, the clock, where the ball is, and Watch on TV with [chan]. */
object SpotDraw {
    class Ids(val root: Int, val stripeAway: Int, val stripeHome: Int, val league: Int, val pill: Int, val awayLogo: Int, val homeLogo: Int,
              val awayName: Int, val homeName: Int, val awayScore: Int, val homeScore: Int, val mid: Int, val state: Int, val sit: Int, val watch: Int)
    val LIST = Ids(R.id.sp_root, R.id.sp_stripe_away, R.id.sp_stripe_home, R.id.sp_league, R.id.sp_pill, R.id.sp_away_logo, R.id.sp_home_logo,
        R.id.sp_away_name, R.id.sp_home_name, R.id.sp_away_score, R.id.sp_home_score, R.id.sp_mid, R.id.sp_state, R.id.sp_sit, R.id.sp_watch)

    fun fill(ctx: Context, v: RemoteViews, i: Ids, g: WGame, chan: String) {
        val awayC = TeamColors.team(g.away.color, g.away.alt); val homeC = TeamColors.team(g.home.color, g.home.alt)
        val mineC = if (g.home.mine) homeC else awayC
        if (Build.VERSION.SDK_INT >= 31) {
            v.setColorStateList(i.root, "setBackgroundTintList", ColorStateList.valueOf(0xFF000000.toInt() or TeamColors.card(mineC)))
            v.setColorStateList(i.stripeAway, "setBackgroundTintList", ColorStateList.valueOf(0xFF000000.toInt() or awayC))
            v.setColorStateList(i.stripeHome, "setBackgroundTintList", ColorStateList.valueOf(0xFF000000.toInt() or homeC))
        } else {
            v.setInt(i.stripeAway, "setBackgroundColor", 0xFF000000.toInt() or awayC)
            v.setInt(i.stripeHome, "setBackgroundColor", 0xFF000000.toInt() or homeC)
        }
        v.setTextViewText(i.league, g.lg.uppercase())
        // Live, Final (a finished game), or Next.
        val post = g.state == "post"
        v.setTextViewText(i.pill, (if (g.live) tr("Live") else if (post) tr("Final") else tr("Next")).uppercase())
        if (Build.VERSION.SDK_INT >= 31) v.setColorStateList(i.pill, "setBackgroundTintList", ColorStateList.valueOf(if (g.live) 0xFFE5484D.toInt() else if (post) 0xFF3A4566.toInt() else 0xFF5B8CFF.toInt()))
        logo(ctx, v, i.awayLogo, g.away); logo(ctx, v, i.homeLogo, g.home)
        v.setTextViewText(i.awayName, name(g.away)); v.setTextViewText(i.homeName, name(g.home))
        if (g.state != "pre") {
            val a = g.away.score?.toIntOrNull(); val h = g.home.score?.toIntOrNull()
            v.setTextViewText(i.awayScore, g.away.score.orEmpty()); v.setTextViewText(i.homeScore, g.home.score.orEmpty())
            // The side behind is dimmed.
            v.setTextColor(i.awayScore, if (a != null && h != null && a < h) 0xFF8A93A8.toInt() else Color.WHITE)
            v.setTextColor(i.homeScore, if (a != null && h != null && h < a) 0xFF8A93A8.toInt() else Color.WHITE)
            v.setTextViewText(i.mid, "–")
            v.setTextViewTextSize(i.mid, android.util.TypedValue.COMPLEX_UNIT_SP, 30f)
            v.setTextColor(i.mid, 0xFF8A93A8.toInt())
        } else {
            v.setTextViewText(i.awayScore, ""); v.setTextViewText(i.homeScore, "")
            v.setTextViewText(i.mid, starts(ctx, g, short = true))
            v.setTextViewTextSize(i.mid, android.util.TypedValue.COMPLEX_UNIT_SP, 26f)
            v.setTextColor(i.mid, Color.WHITE)
        }
        // Under the score: the clock, Final, or the day (not the same time twice).
        v.setTextViewText(i.state, if (g.live || post) g.detail.ifBlank { tr("Final") } else if (android.text.format.DateUtils.isToday(g.start)) tr("Today") else java.text.SimpleDateFormat("EEEE", java.util.Locale.getDefault()).format(java.util.Date(g.start)))
        v.setTextColor(i.state, if (g.live) 0xFFFF8F8F.toInt() else 0xFFC9D1E3.toInt())
        v.setTextViewText(i.sit, g.sit)
        v.setViewVisibility(i.sit, if (g.sit.isBlank()) android.view.View.GONE else android.view.View.VISIBLE)
        v.setTextViewText(i.watch, "▶  " + tr("Watch on TV") + if (chan.isNotBlank()) " · $chan" else "")
    }

    private fun name(t: WTeam): CharSequence = SpannableString(t.name.ifBlank { t.abbr }).also { if (t.mine) it.setSpan(StyleSpan(Typeface.BOLD), 0, it.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }

    /** A team's logo kept on the phone (SportsWidgetWorker), by its address (LogoProvider), or TiviBro's mark. */
    fun logo(ctx: Context, v: RemoteViews, id: Int, t: WTeam) {
        val f = if (t.logo.startsWith("https://")) SportsWidgetWorker.file(ctx, t.logo) else null
        if (f != null && f.exists()) v.setImageViewUri(id, LogoProvider.uri(f)) else v.setImageViewResource(id, R.drawable.ic_tile)
    }

    /** When a game starts: "3:30 PM" today ([short]) or "Today 3:30 PM", "Fri 3:00 PM" this week. */
    fun starts(ctx: Context, g: WGame, short: Boolean): String {
        val d = java.util.Date(g.start)
        val time = android.text.format.DateFormat.getTimeFormat(ctx).format(d)
        if (android.text.format.DateUtils.isToday(g.start)) return if (short) time else tr("Today {x}", "x" to time)
        return java.text.SimpleDateFormat("EEE", java.util.Locale.getDefault()).format(d) + " " + time
    }
}
