package app.tivibro.phone

import app.tivibro.phone.data.BackupTools
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Backups changed on the phone without the TV (discussion #23): merging, edits from the offline web editor, settings. */
class BackupToolsTest {
    private fun backup(vararg pls: JSONObject, edits: JSONObject = JSONObject()) = JSONObject()
        .put("app", "TiviBro").put("kind", "backup").put("format", 2)
        .put("settings", JSONObject().put("active", pls.firstOrNull()?.optString("id") ?: "").put("playlists", org.json.JSONArray(pls.toList())).put("textSize", "m"))
        .put("edits", edits).put("snaps", JSONObject())
    private fun xc(id: String, server: String, user: String) = JSONObject().put("id", id).put("type", "xtream").put("server", server).put("user", user).put("pass", "p").put("name", user)

    @Test fun mergeAddsOnlyNewPlaylists() {
        val a = backup(xc("p1", "http://a.example", "bob"), edits = JSONObject().put("p1", JSONObject().put("renames", JSONObject().put("x1", "Mine"))))
        val b = backup(xc("q9", "http://a.example/", "bob"), xc("q2", "http://b.example", "amy"),
            edits = JSONObject().put("q9", JSONObject().put("renames", JSONObject().put("x1", "Theirs"))).put("q2", JSONObject().put("renames", JSONObject().put("x5", "Amy's"))))
        val (out, added) = BackupTools.merge(a, b)
        assertEquals(1, added)                                     // the same login under another id isn't added twice
        assertEquals(listOf("p1", "q2"), BackupTools.playlists(out).map { it.first })
        assertEquals("Mine", out.getJSONObject("edits").getJSONObject("p1").getJSONObject("renames").getString("x1"))
        assertEquals("Amy's", out.getJSONObject("edits").getJSONObject("q2").getJSONObject("renames").getString("x5"))
        assertEquals(1, a.getJSONObject("settings").getJSONArray("playlists").length())    // the original is untouched
    }

    @Test fun editsFromThePhoneGoIntoTheirPlaylist() {
        val a = backup(xc("p1", "http://a.example", "bob"), xc("p2", "http://c.example", "cy"),
            edits = JSONObject().put("p1", JSONObject().put("hiddenGroups", JSONObject()).put("watch", JSONObject().put("k", 1))))
        val saved = JSONObject().put("edits", JSONObject().put("hiddenGroups", JSONObject().put("x7", 1)).put("renames", JSONObject().put("x1", "News")))
            .put("names", JSONObject().put("enabled", true))
        val out = BackupTools.withEdits(a, "p1", saved)
        val e = out.getJSONObject("edits").getJSONObject("p1")
        assertEquals(1, e.getJSONObject("hiddenGroups").getInt("x7"))
        assertEquals("News", e.getJSONObject("renames").getString("x1"))
        assertTrue(e.has("watch"))                                  // what the editor doesn't send stays
        assertTrue(out.getJSONObject("settings").getJSONArray("playlists").getJSONObject(0).getJSONObject("names").getBoolean("enabled"))
        assertFalse(out.getJSONObject("settings").getJSONArray("playlists").getJSONObject(1).has("names"))
        assertFalse(a.getJSONObject("edits").getJSONObject("p1").getJSONObject("hiddenGroups").has("x7"))
    }

    @Test fun settingsInABackup() {
        val a = backup(xc("p1", "http://a.example", "bob"))
        val size = BackupTools.CHOICES.first { it.key == "textSize" }
        val adult = BackupTools.CHOICES.first { it.key == "adult" }
        val out = BackupTools.withSettings(a, mapOf(size to "l", adult to true))
        assertEquals("l", BackupTools.get(out, size))
        assertEquals(true, out.getJSONObject("settings").getJSONObject("filter").getBoolean("adult"))
        assertEquals("m", BackupTools.get(a, size))
    }
}
