/* A game's inner card in the Sports widget (tap a game, anywhere but Watch on TV): the score by period, each team's
   leaders, the last play and win chance while it's live, both teams' standings, and ESPN's highlights.  Read from
   ESPN's game summary (site.api.espn.com/.../summary?event=<id>, about 400 KB as it has every play), so only when a
   game is opened, again every two minutes while it's live and open, and kept on the phone between draws.  The parts
   used follow the TV's own reading of it (app/js/sports.js readSummary).  Which game each widget has open is kept
   here too (DetailOpen): back to the list with the back arrow, or by itself after 20 minutes. */
package app.tivibro.phone.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// The objects in a JSON array, each through [f] (nulls left out); and an array's strings.
private fun <T> arr(a: JSONArray?, f: (JSONObject) -> T?): List<T> = (0 until (a?.length() ?: 0)).mapNotNull { a!!.optJSONObject(it)?.let(f) }
private fun strs(a: JSONArray?): List<String> = (0 until (a?.length() ?: 0)).map { a!!.optString(it) }

/** One team's line: its abbreviation, total and each period's points. */
data class DLine(val abbr: String, val score: String, val periods: List<String>)
/** A leader: what (Passing Yards), who (J. Goff) and the figure ("245 YDS, 2 TD"). */
data class DLeader(val abbr: String, val what: String, val who: String, val value: String)
/** A row of a standings table: the team, its record, one more figure (GB, PTS) and whether it plays in this game. */
data class DStand(val team: String, val rec: String, val extra: String, val playing: Boolean)
data class DGroup(val name: String, val rows: List<DStand>)
/** A highlight video or story: its headline and where it plays (ESPN's page for it). */
data class DNews(val title: String, val url: String, val video: Boolean)

data class WDetail(val lines: List<DLine>, val leaders: List<DLeader>, val standings: List<DGroup>, val news: List<DNews>,
                   val lastPlay: String, val chance: String, val venue: String, val at: Long,
                   /** The scoring plays, newest first ("Q4 10:32  DET  J. Gibbs 12 yd run"). */
                   val scoring: List<String> = emptyList()) {
    fun json(): JSONObject = JSONObject()
        .put("lines", JSONArray().apply { lines.forEach { put(JSONObject().put("a", it.abbr).put("s", it.score).put("p", JSONArray(it.periods))) } })
        .put("leaders", JSONArray().apply { leaders.forEach { put(JSONObject().put("a", it.abbr).put("w", it.what).put("n", it.who).put("v", it.value)) } })
        .put("standings", JSONArray().apply { standings.forEach { g -> put(JSONObject().put("n", g.name).put("r", JSONArray().apply { g.rows.forEach { put(JSONObject().put("t", it.team).put("r", it.rec).put("x", it.extra).put("p", it.playing)) } })) } })
        .put("news", JSONArray().apply { news.forEach { put(JSONObject().put("t", it.title).put("u", it.url).put("v", it.video)) } })
        .put("last", lastPlay).put("chance", chance).put("venue", venue).put("at", at).put("scoring", JSONArray(scoring))

    companion object {
        fun from(j: JSONObject) = WDetail(
            arr(j.optJSONArray("lines")) { DLine(it.optString("a"), it.optString("s"), strs(it.optJSONArray("p"))) },
            arr(j.optJSONArray("leaders")) { DLeader(it.optString("a"), it.optString("w"), it.optString("n"), it.optString("v")) },
            arr(j.optJSONArray("standings")) { g -> DGroup(g.optString("n"), arr(g.optJSONArray("r")) { DStand(it.optString("t"), it.optString("r"), it.optString("x"), it.optBoolean("p")) }) },
            arr(j.optJSONArray("news")) { DNews(it.optString("t"), it.optString("u"), it.optBoolean("v")) },
            j.optString("last"), j.optString("chance"), j.optString("venue"), j.optLong("at"), strs(j.optJSONArray("scoring")))
    }
}

/** Reading, keeping and tidying games' summaries for the inner card. */
object GameDetail {
    /** ESPN's game summary read into what the inner card shows.  [g]: the game, for its teams.  Pure, for tests. */
    fun parse(s: JSONObject, g: WGame, at: Long = System.currentTimeMillis()): WDetail {
        val comp = s.optJSONObject("header")?.optJSONArray("competitions")?.optJSONObject(0)
        // Away first, as the widget shows them.
        val lines = arr(comp?.optJSONArray("competitors")) { t ->
            Triple(t.optString("homeAway") == "home", t.optJSONObject("team")?.optString("abbreviation").orEmpty(), t)
        }.sortedBy { if (it.first) 1 else 0 }.map { (_, abbr, t) ->
            DLine(abbr, t.optString("score"), arr(t.optJSONArray("linescores")) { l -> l.optString("displayValue").ifBlank { l.optString("value") } })
        }
        // Each team's top three (the TV shows the same), away team first.
        val leaders = arr(s.optJSONArray("leaders")) { tl ->
            val abbr = tl.optJSONObject("team")?.optString("abbreviation").orEmpty()
            arr(tl.optJSONArray("leaders")) { x ->
                val l = x.optJSONArray("leaders")?.optJSONObject(0) ?: return@arr null
                val a = l.optJSONObject("athlete")
                DLeader(abbr, x.optString("displayName").ifBlank { x.optString("name") }, a?.optString("shortName").orEmpty().ifBlank { a?.optString("displayName").orEmpty() }, l.optString("displayValue"))
            }.take(3)
        }.let { both -> both.sortedBy { l -> if (l.firstOrNull()?.abbr == g.home.abbr) 1 else 0 }.flatten() }
        val names = setOf(g.away.name, g.home.name, g.away.abbr, g.home.abbr).filter { it.isNotBlank() }
        val standings = arr(s.optJSONObject("standings")?.optJSONArray("groups")) { gr ->
            DGroup(gr.optString("header").replace(Regex("^\\d{4}(-\\d{2})?\\s+"), ""), arr(gr.optJSONObject("standings")?.optJSONArray("entries")) { e ->
                val st = HashMap<String, String>(); arr(e.optJSONArray("stats")) { x -> st[x.optString("name")] = x.optString("displayValue") }
                val w = st["wins"]; val l = st["losses"]
                val rec = if (w != null && l != null) "$w-$l" + (st["otLosses"]?.let { "-$it" } ?: st["ties"]?.takeIf { it != "0" }?.let { "-$it" } ?: "") else st["overall"].orEmpty()
                val extra = st["points"]?.let { "$it PTS" } ?: st["gamesBehind"]?.let { "$it GB" } ?: st["winPercent"]?.let { "$it PCT" } ?: ""
                val team = e.optString("team")
                DStand(team, rec, extra, names.any { n -> team.contains(n, ignoreCase = true) })
            })
        }.filter { it.rows.isNotEmpty() }.take(2)
        // Highlights: ESPN's videos of the game first, then stories that name one of its teams (the league's news is there too).
        fun link(o: JSONObject) = o.optJSONObject("links")?.let { l -> l.optJSONObject("web")?.optString("href") ?: l.optJSONObject("mobile")?.optString("href") }.orEmpty()
        val videos = arr(s.optJSONArray("videos")) { v -> DNews(v.optString("headline"), link(v), true) }
        val teamNames = listOf(g.away.name, g.home.name).filter { it.length > 2 }
        val stories = arr(s.optJSONObject("news")?.optJSONArray("articles")) { a -> DNews(a.optString("headline"), link(a), false) }
            .filter { n -> teamNames.any { n.title.contains(it, ignoreCase = true) } }
        val news = (videos + stories).filter { it.title.isNotBlank() && it.url.startsWith("https://") }.distinctBy { it.title }.take(6)
        // The last play: football's situation or the drive under way, otherwise the plays' last.
        fun lastOf(p: JSONArray?) = p?.let { it.optJSONObject(it.length() - 1)?.optString("text") }.orEmpty()
        val last = s.optJSONObject("situation")?.optJSONObject("lastPlay")?.optString("text").orEmpty()
            .ifBlank { lastOf(s.optJSONObject("drives")?.optJSONObject("current")?.optJSONArray("plays")) }
            .ifBlank { lastOf(s.optJSONArray("plays")) }
        // Scoring plays, newest first: the period and clock, the team and what happened.
        val scoring = arr(s.optJSONArray("scoringPlays")) { p ->
            val per = p.optJSONObject("period")?.optInt("number") ?: 0
            val clock = p.optJSONObject("clock")?.optString("displayValue").orEmpty()
            val abbr = p.optJSONObject("team")?.optString("abbreviation").orEmpty()
            listOf(if (per > 0) periodName(g.lg, per) + (if (clock.isNotBlank()) " $clock" else "") else "", abbr, p.optString("text")).filter { it.isNotBlank() }.joinToString("  ").take(160)
        }.reversed().take(6)
        // Win chance, from ESPN's win probability while it's on (the home side's, said for the leader).
        val wp = s.optJSONArray("winprobability")?.let { p -> p.optJSONObject(p.length() - 1) }
        val chance = wp?.optDouble("homeWinPercentage", Double.NaN)?.takeIf { !it.isNaN() && g.live }?.let { h ->
            val home = h >= 0.5; val pct = Math.round((if (home) h else 1 - h) * 100)
            "${if (home) g.home.abbr else g.away.abbr} $pct%"
        }.orEmpty()
        val v = s.optJSONObject("gameInfo")?.optJSONObject("venue")
        val venue = listOf(v?.optString("fullName").orEmpty(), v?.optJSONObject("address")?.optString("city").orEmpty()).filter { it.isNotBlank() }.joinToString(", ")
        return WDetail(lines, leaders, standings, news, last.take(220), chance, venue, at, scoring)
    }

    /** A period as the sport says it: Q4 (football, basketball), P2 (hockey), H1 (college basketball, soccer), 7th (baseball); OT after regulation. */
    fun periodName(lg: String, n: Int): String = when (lg) {
        "nhl" -> if (n > 3) "OT" else "P$n"
        "ncaab", "mls" -> if (n > 2) "OT" else "H$n"
        "mlb" -> "$n" + when { n % 100 in 11..13 -> "th"; n % 10 == 1 -> "st"; n % 10 == 2 -> "nd"; n % 10 == 3 -> "rd"; else -> "th" }
        else -> if (n > 4) "OT" else "Q$n"
    }

    /** A game's summary from ESPN, read into a WDetail and kept for the widget's draws; null when ESPN didn't answer. */
    fun fetch(ctx: Context, g: WGame, get: (String) -> JSONObject? = Scores::getJson): WDetail? {
        val path = Scores.PATHS[g.lg] ?: return null
        val s = get("https://site.api.espn.com/apis/site/v2/sports/$path/summary?event=${g.id}") ?: return null
        return parse(s, g).also { d -> runCatching { file(ctx, g.id).writeText(d.json().toString()) } }
    }
    /** The game's summary as last read, or null. */
    fun cached(ctx: Context, id: String): WDetail? = runCatching { file(ctx, id).takeIf { it.exists() }?.let { WDetail.from(JSONObject(it.readText())) } }.getOrNull()
    private fun file(ctx: Context, id: String) = File(File(ctx.filesDir, "widget-games").apply { mkdirs() }, id.filter { it.isLetterOrDigit() } + ".json")
    /** Summaries of games no widget has open: only the open ones are kept. */
    fun tidy(ctx: Context) { val keep = DetailOpen.all(ctx).map { it.filter { c -> c.isLetterOrDigit() } + ".json" }.toSet(); File(ctx.filesDir, "widget-games").listFiles()?.forEach { if (it.name !in keep) it.delete() } }
}

/** Which game each Sports widget has open (its inner card), and since when.  Closed by the back arrow, or after 20 minutes. */
object DetailOpen {
    private const val FOR_MS = 20 * 60_000L
    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("sports-widget-open", Context.MODE_PRIVATE)
    fun open(ctx: Context, widget: Int, game: String) { prefs(ctx).edit().putString("g$widget", game).putLong("t$widget", System.currentTimeMillis()).apply() }
    fun close(ctx: Context, widget: Int) { prefs(ctx).edit().remove("g$widget").remove("t$widget").apply() }
    /** The game [widget] has open, or null (none, or opened over 20 minutes ago). */
    fun of(ctx: Context, widget: Int): String? {
        val p = prefs(ctx); val g = p.getString("g$widget", null) ?: return null
        return if (System.currentTimeMillis() - p.getLong("t$widget", 0) > FOR_MS) null else g
    }
    /** Every game a widget has open now. */
    fun all(ctx: Context): Set<String> = SportsWidgetWorker.ids(ctx).toList().mapNotNull { w -> of(ctx, w) }.toSet()
}
