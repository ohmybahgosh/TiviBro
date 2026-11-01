package app.tivibro.phone

import app.tivibro.phone.proto.Discovery
import app.tivibro.phone.proto.EditorState
import app.tivibro.phone.proto.Pairing
import app.tivibro.phone.proto.TbException
import app.tivibro.phone.proto.TvClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.net.InetAddress

/**
 * Against the TV's real helper code: CI starts tests/android/fake-tv.js (service/companion.js with
 * pairing open, and the web editor) and passes TB_FAKE_TV=host:port:CODE:TVID.  Skipped without it.
 */
class LiveTvTest {
    private val env = System.getenv("TB_FAKE_TV")

    @Test fun pairAndUseARealHelper() {
        assumeTrue(env != null)
        val (host, port, code) = env!!.split(":")
        val p = port.toInt()

        val found = Discovery.find(1200, listOf(InetAddress.getByName(host)), p)
        assertTrue("discovery answers", found.any { it.port == p })

        val wrong = runCatching { Pairing.pair(host, p, "ZZZZ-ZZZZ-ZZZZ", "Wrong", "Test") }.exceptionOrNull()
        assertEquals("wrong", (wrong as TbException).code)

        val tv = Pairing.pair(host, p, code, "CI phone", "JUnit")
        assertEquals(32, tv.key.size)
        val c = TvClient(tv)
        val info = c.info()
        assertEquals("TiviBro", info.getString("app"))
        assertEquals("CI phone", info.getJSONObject("phone").getString("name"))
        c.open()
        val ed = c.editor()
        assertTrue("the editor is ready, for this TV", ed is EditorState.Ready && app.tivibro.phone.proto.editorUrlOk(ed.url, tv))

        // The remote and Play on TV, against the stand-in TiviBro.
        var lineup: app.tivibro.phone.proto.Lineup? = null
        for (i in 0 until 20) { lineup = app.tivibro.phone.proto.Lineup.from(c.lineup(0)); if (lineup != null) break; Thread.sleep(300) }
        assertTrue("the channel list arrives", lineup != null && lineup.channels.size == 40 && lineup.groups.any { it.name == "Sports" })
        val st0 = c.state(0, false)
        c.play("fake|5")
        val st1 = c.state(st0.rev, true)
        assertEquals("Big Ten 10", st1.channel)
        assertEquals("Michigan vs Ohio State", st1.now?.title)
        c.key("chup")
        assertEquals("fake|6", c.state(st1.rev, true).channelKey)
        val v = c.volume("up")
        assertTrue("volume answers", v != null && v.level == 13)
        val bad = runCatching { c.key("power") }.exceptionOrNull() as TbException
        assertEquals("bad", bad.code)

        // Questions for TiviBro (POST /v1/ask): the guide, favorites, movies, typing, links and backups.
        val g = app.tivibro.phone.proto.GuidePage.from(c.ask("guide", org.json.JSONObject().put("group", "sports").put("limit", 5)).getJSONObject("data"))
        assertTrue("a guide page for a group", g.total == 16 && g.rows.size == 5 && g.rows.all { (it.progs?.size ?: 0) == 3 })
        val sch = app.tivibro.phone.proto.Schedule.from(c.ask("schedule", org.json.JSONObject().put("k", "fake|5")).getJSONObject("data"))
        assertTrue("a channel's schedule, with descriptions", sch.progs.size == 3 && sch.progs[0].desc.startsWith("About") && sch.catchupDays == 3)
        assertTrue("a favorite", c.ask("fav", org.json.JSONObject().put("k", "fake|9").put("on", true)).getJSONObject("data").getBoolean("on"))
        val miss = runCatching { c.ask("fav", org.json.JSONObject().put("k", "nope")) }.exceptionOrNull() as TbException
        assertEquals("TiviBro's reason comes back", "tv", miss.code)
        val page = app.tivibro.phone.proto.VodPage.from(c.ask("voditems", org.json.JSONObject().put("kind", "movie").put("q", "movie 1")).getJSONObject("data"))
        assertTrue("movies, searched", page.items.isNotEmpty() && page.items.all { it.name.startsWith("Movie 1") })
        val show = app.tivibro.phone.proto.VodInfo.from(c.ask("vodinfo", org.json.JSONObject().put("kind", "series").put("id", "7")).getJSONObject("data"))
        assertEquals(22, show.seasons[0].episodes[0].progress)
        val unsealed = runCatching { c.ask("backup") }.exceptionOrNull() as TbException
        assertEquals("backups only travel sealed", "sealed", unsealed.code)
        val bk = c.ask("backup", seal = true).getJSONObject("data").getJSONObject("backup")
        assertEquals("secret", bk.getJSONObject("settings").getJSONArray("playlists").getJSONObject(0).getString("pass"))
        assertEquals(1, c.ask("restore", org.json.JSONObject().put("backup", bk), seal = true).getJSONObject("data").getInt("playlists"))
        assertTrue(c.ask("input", org.json.JSONObject().put("id", 1).put("value", "hunter2"), seal = true).getBoolean("ok"))
        val added = c.ask("playlist", org.json.JSONObject().put("link", "http://h/get.php?username=a&password=b"), seal = true)
        assertTrue("a shared link is added", added.getJSONObject("data").getString("msg").startsWith("Added"))
        val refused = runCatching { c.ask("playlist", org.json.JSONObject().put("link", "http://h"), seal = true) }.exceptionOrNull() as TbException
        assertEquals("a sealed refusal is opened too", "tv", refused.code)

        // A wrong key: refused, and the answer is not trusted.
        val wrongKey = TvClient(tv.copy(key = ByteArray(32)))
        val e = runCatching { wrongKey.info() }.exceptionOrNull() as TbException
        assertTrue(e.unsigned)

        // An old clock: the TV says so, signed.
        val old = runCatching { c.call("GET", "/v1/info", null, time = System.currentTimeMillis() - 3_600_000) }.exceptionOrNull() as TbException
        assertEquals("clock", old.code)

        c.forget()
        val gone = runCatching { c.info() }.exceptionOrNull() as TbException
        assertEquals("unpaired", gone.code)
    }
}
