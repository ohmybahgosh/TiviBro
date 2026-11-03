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
        val all = NowState(rev = 1, open = true, movies = true, series = true, media = true, onnow = true)
        assertEquals(Shortcut.entries.toList(), Shortcut.forTv(all))
        val none = NowState(rev = 1, open = true, movies = false, series = false, media = false, onnow = false)
        assertFalse(Shortcut.VOD in Shortcut.forTv(none))
        assertEquals("Shows", Shortcut.tab(Shortcut.VOD, NowState(rev = 1, open = true, movies = false, series = true)))
        assertEquals("Movies", Shortcut.tab(Shortcut.VOD, null))
        assertNull(Shortcut.tab(Shortcut.BACKUPS, all))
    }
}
