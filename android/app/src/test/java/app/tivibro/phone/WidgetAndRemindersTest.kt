/* The Sports widget's reading of ESPN (widget/Scores.kt), the followed teams it keeps (widget/MyTeams.kt) and the
   phone's reminder list (notify/PhoneReminders.kt): the pure parts, without Android. */
package app.tivibro.phone

import app.tivibro.phone.notify.PhoneReminder
import app.tivibro.phone.notify.PhoneReminders
import app.tivibro.phone.proto.SportsList
import app.tivibro.phone.widget.FollowedTeam
import app.tivibro.phone.widget.MyTeams
import app.tivibro.phone.widget.Scores
import app.tivibro.phone.widget.TeamColors
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetAndRemindersTest {
    private val wings = FollowedTeam("nhl:det", "5", "DET", "Red Wings", "https://a.espncdn.com/i/teamlogos/nhl/500/det.png", "e30526")

    // A scoreboard event as ESPN writes it: scores as text, the status under competitions too.
    private fun event(id: String, state: String, detail: String, awayId: String, awayAbbr: String, homeId: String, homeAbbr: String, score: Boolean) = JSONObject("""
        {"id":"$id","date":"2026-11-27T20:00Z","status":{"type":{"state":"$state","shortDetail":"$detail"}},
         "competitions":[{"competitors":[
           {"homeAway":"home","score":${if (score) "\"2\"" else "null"},"team":{"id":"$homeId","abbreviation":"$homeAbbr","shortDisplayName":"$homeAbbr name","logo":"https://x/$homeAbbr.png"}},
           {"homeAway":"away","score":${if (score) "\"3\"" else "null"},"team":{"id":"$awayId","abbreviation":"$awayAbbr","shortDisplayName":"$awayAbbr name","logo":"https://x/$awayAbbr.png"}}]}]}
    """.trimIndent())

    @Test fun liveGameOfAFollowedTeam() {
        val g = Scores.event(event("1", "in", "2nd 12:31", "5", "DET", "29", "CBJ", true), "nhl", listOf(wings))!!
        assertEquals("DET", g.away.abbr); assertEquals("CBJ", g.home.abbr)
        assertTrue(g.live); assertEquals("3", g.away.score); assertEquals("2", g.home.score)
        assertEquals("nhl:det", g.team)
        assertEquals(java.time.Instant.parse("2026-11-27T20:00:00Z").toEpochMilli(), g.start)
    }

    @Test fun gamesWithoutAFollowedTeamAreLeftOut() {
        assertNull(Scores.event(event("2", "pre", "7:00 PM", "6", "BOS", "29", "CBJ", false), "nhl", listOf(wings)))
    }

    @Test fun teamPageScoreObjectsAndNoEspnId() {
        // A team page's nextEvent writes the score as { displayValue }; an older TV sent no ESPN id, so the abbreviation matches.
        val e = event("3", "post", "Final/OT", "29", "CBJ", "5", "DET", false)
        val comps = e.getJSONArray("competitions").getJSONObject(0).getJSONArray("competitors")
        comps.getJSONObject(0).put("score", JSONObject().put("displayValue", "4"))
        val g = Scores.event(e, "nhl", listOf(wings.copy(eid = "")))!!
        assertEquals("4", g.home.score); assertTrue(g.home.mine)
    }

    @Test fun orderIsLiveThenNextThenResults() {
        val t = listOf(wings)
        val live = Scores.event(event("a", "in", "", "5", "DET", "1", "X", true), "nhl", t)!!
        val later = Scores.event(event("b", "pre", "", "5", "DET", "1", "X", false), "nhl", t)!!.copy(start = 2000)
        val sooner = later.copy(id = "c", start = 1000)
        val done = Scores.event(event("d", "post", "", "5", "DET", "1", "X", true), "nhl", t)!!
        assertEquals(listOf("a", "c", "b", "d"), Scores.order(listOf(done, later, live, sooner)).map { it.id })
    }

    @Test fun fetchReadsTheBoardThenTheTeamPage() {
        val asked = mutableListOf<String>()
        val games = Scores.fetch(listOf(wings)) { url ->
            asked += url
            if (url.endsWith("/scoreboard")) JSONObject().put("events", org.json.JSONArray())
            else JSONObject().put("team", JSONObject().put("nextEvent", org.json.JSONArray().put(event("9", "pre", "", "5", "DET", "29", "CBJ", false))))
        }
        assertEquals(listOf("https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard", "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/5"), asked)
        assertEquals("9", games.single().id)
    }

    @Test fun followedTeamsFollowTheTv() {
        val list = SportsList.from(JSONObject("""
            {"rows":[{"id":"mine","t":"My teams","games":[{"id":"1","lg":"nhl","teams":[
              {"id":"nhl:det","eid":"5","abbr":"DET","name":"Red Wings","mine":1},
              {"id":"nhl:bos","abbr":"BOS","name":"Bruins","mine":0}]}]}]}
        """.trimIndent()))
        val old = listOf(FollowedTeam("nhl:bos", "1", "BOS", "Bruins", "", ""), FollowedTeam("nba:det", "8", "DET", "Pistons", "", ""))
        val now = MyTeams.merge(old, list)
        assertEquals(listOf("nba:det", "nhl:det"), now.map { it.id }.sorted())        // the Bruins aren't followed any more; the Pistons have no game, kept
        assertEquals("5", now.first { it.id == "nhl:det" }.eid)
    }

    @Test fun remindersPerTvAndTheirTimes() {
        val now = 1_000_000_000L
        val a = PhoneReminder("tv1", "Den", "k1", "FOX", "Lions at Packers", now + 3_600_000, now + 7_200_000)
        val b = PhoneReminder("tv2", "Bedroom", "k2", "NBC", "News", now + 600_000, now + 1_200_000)
        val gone = PhoneReminder("tv2", "Bedroom", "k3", "CBS", "Old", now - 7_200_000, now - 3_600_000)
        val c = PhoneReminder("tv1", "Den", "k4", "ESPN", "Game", now + 60_000, now + 3_600_000)
        val l = PhoneReminders.merge(listOf(a, b, gone), "tv1", listOf(c), now)
        assertEquals(listOf("k4", "k2"), l.map { it.k })                              // tv1's list replaced, the ended one dropped, soonest first
        assertEquals(now + 3_600_000 - 60_000, PhoneReminders.fireAt(a, now))           // a minute early
        assertEquals(now + 1000, PhoneReminders.fireAt(c.copy(start = now - 5_000), now))  // started already: at once
    }

    /* Home screen widgets can only hold the views Android allows in RemoteViews: anything else (a plain View as a
       spacer, as alpha 225's Remote widget had) shows "Can't load widget". */
    @Test fun widgetLayoutsUseOnlyRemoteViewsClasses() {
        val allowed = setOf("FrameLayout", "LinearLayout", "RelativeLayout", "GridLayout", "AnalogClock", "Button", "Chronometer", "ImageButton", "ImageView",
            "ProgressBar", "TextView", "ViewFlipper", "ListView", "GridView", "StackView", "AdapterViewFlipper", "ViewStub", "TextClock", "merge")
        val dir = java.io.File("src/main/res/layout")
        val files = dir.listFiles { f -> f.name.startsWith("widget_") }.orEmpty()
        assertTrue("widget layouts found", files.isNotEmpty())
        files.forEach { f ->
            val tags = Regex("<([A-Za-z.]+)[\\s>/]").findAll(f.readText()).map { it.groupValues[1] }.filterNot { it == "xml" }.toSet()
            assertEquals(f.name + " uses " + (tags - allowed), emptySet<String>(), tags - allowed)
        }
    }

    @Test fun teamColoursShowOnTheDarkWidget() {
        assertEquals(0xE64100, TeamColors.team("0b1c3a", "e64100"))        // Bears: navy is too dark, their orange
        assertEquals(0x0076B6, TeamColors.team("0076b6", "bbbbbb"))        // Lions: their own blue
        assertTrue(TeamColors.lum(TeamColors.team("041e42", "000000")) > TeamColors.lum(0x041E42))   // dark navy, black second colour: lightened
        assertTrue(TeamColors.lum(TeamColors.card(0xFFCB05)) < 0.2)        // a card stays dark under white text, even for Michigan maize
    }

    @Test fun footballSituationAndNetwork() {
        val e = event("7", "in", "2nd 12:51", "3", "CHI", "8", "DET", true)
        val c = e.getJSONArray("competitions").getJSONObject(0)
        c.put("situation", JSONObject().put("possession", "3").put("downDistanceText", "4th & 13 at DET 22"))
        c.put("broadcasts", org.json.JSONArray().put(JSONObject().put("names", org.json.JSONArray().put("CBS"))))
        val lions = FollowedTeam("nfl:det", "8", "DET", "Lions", "", "")
        val g = Scores.event(e, "nfl", listOf(lions))!!
        assertEquals("CHI · 4th & 13 at DET 22", g.sit); assertEquals("CBS", g.net)
    }

    @Test fun liveGamesFromTheSmallFeeds() {
        val lions = FollowedTeam("nfl:det", "8", "DET", "Lions", "", "")
        val g = Scores.event(event("401873081", "in", "1st", "3", "CHI", "8", "DET", true), "nfl", listOf(lions))!!
        val asked = mutableListOf<String>()
        val up = Scores.refreshLive(g) { url ->
            asked += url.substringAfter("competitions/401873081")
            when {
                url.endsWith("/status") -> JSONObject().put("type", JSONObject().put("state", "in").put("shortDetail", "12:51 - 2nd"))
                url.endsWith("/competitors/8/score") -> JSONObject().put("displayValue", "10")
                url.endsWith("/competitors/3/score") -> JSONObject().put("displayValue", "0")
                url.endsWith("/situation") -> JSONObject().put("possession", JSONObject().put("\$ref", "http://x/teams/8?lang=en")).put("downDistanceText", "2nd & 6 at CHI 34")
                else -> null
            }
        }!!
        assertEquals(listOf("/status", "/competitors/3/score", "/competitors/8/score", "/situation"), asked)
        assertEquals("10", up.home.score); assertEquals("0", up.away.score); assertEquals("12:51 - 2nd", up.detail)
        assertEquals("DET · 2nd & 6 at CHI 34", up.sit)
    }
}
