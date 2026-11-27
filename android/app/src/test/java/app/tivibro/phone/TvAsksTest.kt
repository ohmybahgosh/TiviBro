package app.tivibro.phone

import app.tivibro.phone.proto.NowState
import app.tivibro.phone.proto.Reminder
import app.tivibro.phone.proto.RestorePoint
import app.tivibro.phone.proto.TvDialog
import app.tivibro.phone.proto.editorPageUrl
import app.tivibro.phone.ui.Shortcut
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shapes TiviBro on the TV sends (app/js/settings.js forPhone, app/js/phone.js reminders and snaps). */
class TvAsksTest {
    @Test fun promptFromAReply() {
        val d = TvDialog.from(JSONObject("""{"msg":"","page":null,"dialog":{"id":"d3","kind":"prompt","title":"Password","value":"","hint":"From your provider","secret":true,"ok":"Sign in"}}"""))!!
        assertEquals("d3", d.id); assertEquals("prompt", d.kind); assertTrue(d.secret); assertEquals("Sign in", d.ok); assertEquals("From your provider", d.hint)
        val a = d.answer("hunter2")
        assertEquals("d3", a.getString("dialog")); assertEquals("hunter2", a.getString("value")); assertFalse(a.has("cancel"))
        assertTrue(d.cancel().getBoolean("cancel"))
    }

    @Test fun menuWithTheCurrentOne() {
        val d = TvDialog.from(JSONObject("""{"dialog":{"id":"d4","kind":"menu","title":"Quality","items":[{"label":"Auto","sub":"","current":false},{"label":"HD","sub":"720p","current":true}]}}"""))!!
        assertEquals(2, d.items.size); assertTrue(d.items[1].current); assertEquals("720p", d.items[1].sub)
        assertEquals(1, d.choose(1).getInt("choice"))
        assertEquals("d4", d.yes().getString("dialog"))
    }

    @Test fun noDialogOrAnUnknownOne() {
        assertNull(TvDialog.from(JSONObject("""{"msg":"Saved"}""")))
        assertNull(TvDialog.from(JSONObject("""{"dialog":{"id":"d1","kind":"wizard"}}""")))
        assertNull(TvDialog.from(JSONObject("""{"dialog":{"kind":"confirm"}}""")))
        assertNull(TvDialog.from(null))
    }

    @Test fun confirmWithNullsFromTheTv() {
        val d = TvDialog.from(JSONObject("""{"dialog":{"id":"d5","kind":"confirm","title":"Delete it?","ok":"Delete","items":null,"value":null,"hint":null}}"""))!!
        assertEquals("Delete", d.ok); assertEquals("", d.value); assertEquals("", d.hint); assertTrue(d.items.isEmpty())
    }

    @Test fun reminders() {
        val l = Reminder.list(JSONObject("""{"msg":"","items":[
            {"k":"b","ch":"Two","logo":"","s":2000,"e":3000,"t":"Later","w":"","live":0},
            {"k":"a","ch":"One","logo":"http://x/l.png","s":1000,"e":5000,"t":"Match","w":"team:nfl-det","live":1},
            {"k":"c","ch":"Three","s":1500,"e":1600,"t":"News","w":"election"},
            {"ch":"no key"}]}"""))
        assertEquals(listOf("a", "c", "b"), l.map { it.k })
        assertTrue(l[0].live); assertFalse(l[2].live)
        assertEquals("From My teams", l[0].from)
        assertEquals("From your watchlist: election", l[1].from)
        assertEquals("", l[2].from)
        assertTrue(Reminder.list(JSONObject("{}")).isEmpty())
    }

    @Test fun restorePoints() {
        val l = RestorePoint.list(JSONObject("""{"items":[{"id":"s1","name":"Old","at":100,"kind":"named"},{"id":"s2","name":"","at":300,"kind":"auto","playlist":"p1"},{"name":"no id"}]}"""))
        assertEquals(listOf("s2", "s1"), l.map { it.id })
        assertTrue(l[0].auto); assertFalse(l[1].auto)
    }

    @Test fun editorOnAPage() {
        val base = "http://192.168.1.5:8080/#t=" + "a".repeat(48)
        assertEquals("$base/names", editorPageUrl(base, "names"))
        assertEquals(base, editorPageUrl(base, ""))
        assertEquals(base, editorPageUrl(base, "../x"))
        assertEquals("$base/gc/x", editorPageUrl("$base/gc/x", "names"))
    }

    @Test fun shortcutsFollowWhatTheTvHas() {
        val unknown = Shortcut.forTv(null)
        assertFalse(Shortcut.ON_NOW in unknown); assertFalse(Shortcut.MEDIA in unknown); assertTrue(Shortcut.VOD in unknown)
        assertEquals(listOf(Shortcut.REMOTE, Shortcut.GUIDE, Shortcut.VOD, Shortcut.REMINDERS, Shortcut.EDITOR, Shortcut.BACKUPS, Shortcut.SETTINGS), unknown)
        assertFalse(Shortcut.RECORDINGS in unknown); assertFalse(Shortcut.SPORTS in unknown)
        assertTrue(Shortcut.SPORTS in Shortcut.forTv(NowState(rev = 1, open = true, sports = true)))
        assertEquals("Sports", Shortcut.tab(Shortcut.SPORTS, null))
        assertTrue(Shortcut.RECORDINGS in Shortcut.forTv(NowState(rev = 1, open = true, rec = true)))
        assertFalse(Shortcut.RECORDINGS in Shortcut.forTv(NowState(rev = 1, open = true, rec = false)))
        val all = NowState(rev = 1, open = true, movies = true, series = true, media = true, onnow = true, rec = true, sports = true, plex = true)
        assertEquals(Shortcut.entries.toList(), Shortcut.forTv(all))
        val none = NowState(rev = 1, open = true, movies = false, series = false, media = false, onnow = false)
        assertFalse(Shortcut.VOD in Shortcut.forTv(none))
        assertEquals("Shows", Shortcut.tab(Shortcut.VOD, NowState(rev = 1, open = true, movies = false, series = true)))
        assertEquals("Movies", Shortcut.tab(Shortcut.VOD, null))
        assertNull(Shortcut.tab(Shortcut.BACKUPS, all))
        // Plex: on the home screen once the TV has a Plex server, next to My media; it opens the Plex tab.
        assertFalse(Shortcut.PLEX in unknown)
        assertEquals(Shortcut.PLEX, Shortcut.forTv(all)[Shortcut.forTv(all).indexOf(Shortcut.MEDIA) + 1])
        assertEquals("Plex", Shortcut.tab(Shortcut.PLEX, all))
    }

    @Test fun recordingsFromTheTv() {
        val j = org.json.JSONObject("""{"msg":"Recording X until 9:00 PM.","drive":{"name":"SanDisk","freeMB":20480,"totalMB":61440,"low":false},
            "items":[{"id":"a1","t":"X","ch":"ABC","k":"x1","st":"recording","s":1,"e":2,"at":1,"b":1048576,"dur":60},
                     {"id":"b2","t":"Y","ch":"NBC","k":"x2","st":"scheduled","s":5,"e":9},
                     {"id":"c3","t":"Z","ch":"CBS","k":"x3","st":"done","s":0,"e":1,"b":5,"dur":3600,"pos":1800,"w":0},
                     {"id":"","t":"no id"}]}""")
        val l = app.tivibro.phone.proto.RecList.from(j)
        assertEquals("Recording X until 9:00 PM.", l.msg)
        assertEquals(20480L, l.drive?.freeMB)
        assertEquals(listOf("a1", "b2", "c3"), l.items.map { it.id })
        assertTrue(l.items[0].recording); assertTrue(l.items[1].scheduled); assertTrue(l.items[2].done)
        assertEquals(listOf("Recording now", "Scheduled", "Recorded"), app.tivibro.phone.ui.recGroups(l.items).map { it.first })
        assertNull(app.tivibro.phone.proto.RecList.from(org.json.JSONObject("{}")).drive)
    }
}
