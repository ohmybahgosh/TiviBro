/* A game's inner card in the Sports widget (widget/GameDetail.kt): ESPN's game summary read into the score by period,
   leaders, standings, scoring plays, the last play, win chance and highlights.  The summary is a real one (Bears at
   Lions, Nov 26 2026, live), cut down to the parts read (test resources). */
package app.tivibro.phone

import app.tivibro.phone.widget.GameDetail
import app.tivibro.phone.widget.WDetail
import app.tivibro.phone.widget.WGame
import app.tivibro.phone.widget.WTeam
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GameDetailTest {
    private val summary = JSONObject(javaClass.classLoader!!.getResource("espn-summary-nfl.json")!!.readText())
    private val game = WGame("401873081", "nfl", 0L, "in", "7:20 - 4th",
        WTeam("CHI", "Bears", "", "32", false, "", eid = "3"), WTeam("DET", "Lions", "", "35", true, "nfl:det", eid = "8"))

    @Test fun scoreByPeriodAwayFirst() {
        val d = GameDetail.parse(summary, game, at = 1L)
        assertEquals(listOf("CHI", "DET"), d.lines.map { it.abbr })
        assertEquals(listOf("0", "10", "14", "8"), d.lines[0].periods)
        assertEquals("35", d.lines[1].score)
    }

    @Test fun leadersThreeEachAwayFirst() {
        val d = GameDetail.parse(summary, game)
        assertEquals(6, d.leaders.size)
        assertEquals("CHI", d.leaders.first().abbr)
        assertEquals("Passing Yards", d.leaders.first().what)
        assertTrue(d.leaders.all { it.who.isNotBlank() && it.value.isNotBlank() })
    }

    @Test fun standingsMarkTheTwoTeams() {
        val d = GameDetail.parse(summary, game)
        assertEquals("NFC North Standings", d.standings.first().name)
        val playing = d.standings.first().rows.filter { it.playing }.map { it.team }
        assertEquals(setOf("Detroit", "Chicago"), playing.toSet().intersect(setOf("Detroit", "Chicago")))
        assertTrue(d.standings.first().rows.all { Regex("^\\d+-\\d+").containsMatchIn(it.rec) })
    }

    @Test fun scoringNewestFirstWithPeriodAndClock() {
        val d = GameDetail.parse(summary, game)
        assertTrue(d.scoring.first(), d.scoring.first().startsWith("Q4 7:20  CHI  Rome Odunze 41 Yd pass"))
        assertTrue(d.scoring.size <= 6)
    }

    @Test fun lastPlayChanceAndHighlights() {
        val d = GameDetail.parse(summary, game)
        assertTrue(d.lastPlay.isNotBlank())
        assertTrue(d.chance, Regex("^(CHI|DET) \\d+%$").matches(d.chance))
        // The game's video, then only stories naming the Bears or the Lions (not the league's other news).
        assertTrue(d.news.first().video)
        assertTrue(d.news.drop(1).all { n -> listOf("Bears", "Lions").any { n.title.contains(it, ignoreCase = true) } })
    }

    @Test fun keptAndReadBack() {
        val d = GameDetail.parse(summary, game, at = 42L)
        assertEquals(d, WDetail.from(JSONObject(d.json().toString())))
    }

    @Test fun periodNames() {
        assertEquals("Q4", GameDetail.periodName("nfl", 4)); assertEquals("OT", GameDetail.periodName("nfl", 5))
        assertEquals("P3", GameDetail.periodName("nhl", 3)); assertEquals("H2", GameDetail.periodName("ncaab", 2))
        assertEquals("7th", GameDetail.periodName("mlb", 7)); assertEquals("1st", GameDetail.periodName("mlb", 1))
    }
}
