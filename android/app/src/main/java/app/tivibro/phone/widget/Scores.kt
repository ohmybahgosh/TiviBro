/* Scores for the Sports widget, read by the phone itself from ESPN's public scoreboards (as the TV's sports.js does),
   so the widget stays current with the TV off or the phone away from home:
     scoreboard  site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard   today's games, live scores
     team        site.api.espn.com/apis/site/v2/sports/<sport>/<league>/teams/<id>   its next game (nextEvent)
   One scoreboard per league of the followed teams, plus one team page for each followed team with no game on it. */
package app.tivibro.phone.widget

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** One side of a game: [mine] when it's a followed team ([id] is then TiviBro's id for it). */
data class WTeam(val abbr: String, val name: String, val logo: String, val score: String?, val mine: Boolean, val id: String)

/** A game for the widget.  [state]: "pre", "in" (live) or "post".  [team]: the followed team to play it for. */
data class WGame(val id: String, val lg: String, val start: Long, val state: String, val detail: String, val away: WTeam, val home: WTeam) {
    val live: Boolean get() = state == "in"
    val team: String get() = listOf(away, home).firstOrNull { it.mine }?.id.orEmpty()

    fun json(): JSONObject = JSONObject().put("id", id).put("lg", lg).put("s", start).put("state", state).put("detail", detail).put("away", side(away)).put("home", side(home))
    private fun side(t: WTeam) = JSONObject().put("abbr", t.abbr).put("name", t.name).put("logo", t.logo).put("score", t.score ?: JSONObject.NULL).put("mine", t.mine).put("id", t.id)

    companion object {
        fun from(j: JSONObject) = WGame(j.optString("id"), j.optString("lg"), j.optLong("s"), j.optString("state"), j.optString("detail"), side(j.optJSONObject("away")), side(j.optJSONObject("home")))
        private fun side(j: JSONObject?) = WTeam(j?.optString("abbr").orEmpty(), j?.optString("name").orEmpty(), j?.optString("logo").orEmpty(),
            if (j == null || j.isNull("score")) null else j.optString("score"), j?.optBoolean("mine") == true, j?.optString("id").orEmpty())
    }
}

object Scores {
    private const val BASE = "https://site.api.espn.com/apis/site/v2/sports/"
    /** ESPN's path for each league TiviBro follows teams in (app/js/sports.js LEAGUES). */
    val PATHS = mapOf("nfl" to "football/nfl", "ncaaf" to "football/college-football", "nba" to "basketball/nba", "ncaab" to "basketball/mens-college-basketball",
        "wnba" to "basketball/wnba", "nhl" to "hockey/nhl", "mlb" to "baseball/mlb", "mls" to "soccer/usa.1")

    /** The followed teams' games: live first, then the next ones by time, then today's finished ones.  Reads the network. */
    fun fetch(teams: List<FollowedTeam>, get: (String) -> JSONObject? = ::getJson): List<WGame> {
        val out = LinkedHashMap<String, WGame>()
        teams.groupBy { it.lg }.forEach { (lg, ts) ->
            val path = PATHS[lg] ?: return@forEach
            val board = get(BASE + path + "/scoreboard" + if (lg == "ncaab" || lg == "ncaaf") "?limit=200" else "")
            board?.optJSONArray("events")?.let { a -> (0 until a.length()).mapNotNull { event(a.optJSONObject(it), lg, ts) }.forEach { out[it.id] = it } }
            // A team with no game on today's board: its next one, from its own page.
            ts.filter { t -> out.values.none { g -> g.team == t.id || g.away.id == t.id || g.home.id == t.id } }.forEach { t ->
                val page = get(BASE + path + "/teams/" + (t.eid.ifBlank { t.abbr.lowercase() })) ?: return@forEach
                val next = page.optJSONObject("team")?.optJSONArray("nextEvent")?.optJSONObject(0) ?: return@forEach
                event(next, lg, ts)?.let { out[it.id] = it }
            }
        }
        return order(out.values.toList())
    }

    /** Live, then coming up (soonest first), then finished (latest first). */
    fun order(l: List<WGame>): List<WGame> =
        l.filter { it.live } + l.filter { it.state == "pre" }.sortedBy { it.start } + l.filter { it.state == "post" }.sortedByDescending { it.start }

    /** One ESPN event as a widget game, or null when none of [teams] plays in it.  Pure, for tests. */
    fun event(e: JSONObject?, lg: String, teams: List<FollowedTeam>): WGame? {
        e ?: return null
        val c = e.optJSONArray("competitions")?.optJSONObject(0) ?: return null
        val st = (e.optJSONObject("status") ?: c.optJSONObject("status"))?.optJSONObject("type")
        val comps = c.optJSONArray("competitors") ?: return null
        val sides = (0 until comps.length()).mapNotNull { comps.optJSONObject(it) }.map { side(it, teams) }
        if (sides.size != 2 || sides.none { it.second.mine }) return null
        val away = sides.firstOrNull { !it.first } ?: sides[0]
        val home = sides.firstOrNull { it.first && it !== away } ?: sides[1]
        val start = runCatching { java.time.OffsetDateTime.parse(e.optString("date").let { if (Regex("T\\d\\d:\\d\\dZ$").containsMatchIn(it)) it.replace("Z", ":00Z") else it }).toInstant().toEpochMilli() }.getOrDefault(0L)
        val state = st?.optString("state").orEmpty().ifBlank { "pre" }
        return WGame(e.optString("id"), lg, start, state, st?.optString("shortDetail").orEmpty(), away.second, home.second)
    }

    // A competitor: (home?, the side).  The score is "3" on scoreboards and { displayValue: "3" } on team pages.
    private fun side(t: JSONObject, teams: List<FollowedTeam>): Pair<Boolean, WTeam> {
        val tm = t.optJSONObject("team") ?: JSONObject()
        val eid = tm.optString("id"); val abbr = tm.optString("abbreviation")
        val mine = teams.firstOrNull { (it.eid.isNotBlank() && it.eid == eid) || (it.eid.isBlank() && it.abbr.equals(abbr, ignoreCase = true)) }
        val sc = t.opt("score")
        val score = when (sc) { is JSONObject -> sc.optString("displayValue").ifBlank { null }; null, JSONObject.NULL -> null; else -> sc.toString().ifBlank { null } }
        val logo = tm.optString("logo").ifBlank { tm.optJSONArray("logos")?.optJSONObject(0)?.optString("href").orEmpty() }
        return (t.optString("homeAway") == "home") to WTeam(abbr, tm.optString("shortDisplayName").ifBlank { tm.optString("displayName") }, logo, score, mine != null, mine?.id.orEmpty())
    }

    private fun getJson(url: String): JSONObject? = runCatching {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000; c.readTimeout = 12000
        c.setRequestProperty("Accept", "application/json")
        try { if (c.responseCode == 200) JSONObject(c.inputStream.bufferedReader().readText()) else null } finally { c.disconnect() }
    }.getOrNull()
}
