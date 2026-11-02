/* Working on backups on the phone, without the TV (discussion #23): merging two, changing a few settings
   inside one, and putting edits made in the web editor on the phone (OfflineEditorScreen.kt) back into
   one.  The backup is the TV's own format (app/js/webedit.js, Backup.create): settings with every
   playlist, each playlist's edits by id, and its restore points.  Everything here makes a new copy;
   the original backup is never changed. */
package app.tivibro.phone.data

import org.json.JSONArray
import org.json.JSONObject

object BackupTools {
    /** A deep copy, so a change never reaches the backup it came from. */
    fun copy(b: JSONObject): JSONObject = JSONObject(b.toString())

    fun playlists(b: JSONObject): List<Pair<String, String>> {
        val l = b.optJSONObject("settings")?.optJSONArray("playlists") ?: return emptyList()
        return (0 until l.length()).mapNotNull { i -> l.optJSONObject(i)?.let { p -> p.optString("id") to p.optString("name").ifBlank { p.optString("user").ifBlank { "Playlist" } } } }
    }

    // The same provider login, whatever id each TV gave it.
    private fun same(a: JSONObject, b: JSONObject): Boolean {
        if (a.optString("id").isNotBlank() && a.optString("id") == b.optString("id")) return true
        if (a.optString("type") != b.optString("type")) return false
        return if (a.optString("type") == "m3u") a.optString("m3u").isNotBlank() && a.optString("m3u") == b.optString("m3u")
        else a.optString("server").trimEnd('/').equals(b.optString("server").trimEnd('/'), true) && a.optString("user") == b.optString("user") && a.optString("server").isNotBlank()
    }

    /** [a] with the playlists from [b] that [a] doesn't have, each with its edits and restore points.
     *  Settings stay [a]'s; for a playlist in both, [a]'s edits are kept.  Says how many were added. */
    fun merge(a: JSONObject, b: JSONObject): Pair<JSONObject, Int> {
        val out = copy(a)
        val s = out.optJSONObject("settings") ?: JSONObject().also { out.put("settings", it) }
        val mine = s.optJSONArray("playlists") ?: JSONArray().also { s.put("playlists", it) }
        val theirs = b.optJSONObject("settings")?.optJSONArray("playlists") ?: JSONArray()
        val edits = out.optJSONObject("edits") ?: JSONObject().also { out.put("edits", it) }
        val snaps = out.optJSONObject("snaps") ?: JSONObject().also { out.put("snaps", it) }
        var added = 0
        for (i in 0 until theirs.length()) {
            val p = theirs.optJSONObject(i) ?: continue
            if ((0 until mine.length()).any { j -> mine.optJSONObject(j)?.let { same(it, p) } == true }) continue
            val id = p.optString("id")
            mine.put(JSONObject(p.toString()))
            b.optJSONObject("edits")?.opt(id)?.let { if (it != JSONObject.NULL) edits.put(id, JSONObject(it.toString())) }
            b.optJSONObject("snaps")?.optJSONArray(id)?.let { snaps.put(id, JSONArray(it.toString())) }
            added++
        }
        if (s.optString("active").isBlank() && mine.length() > 0) s.put("active", mine.getJSONObject(0).optString("id"))
        return out to added
    }

    /** The edits and name rules the web editor saved (what it would have sent the TV), into playlist [pid]. */
    fun withEdits(b: JSONObject, pid: String, saved: JSONObject): JSONObject {
        val out = copy(b)
        val edits = out.optJSONObject("edits") ?: JSONObject().also { out.put("edits", it) }
        val cur = edits.optJSONObject(pid) ?: JSONObject()
        val e = saved.optJSONObject("edits") ?: JSONObject()
        e.keys().forEach { k -> cur.put(k, e.get(k)) }
        edits.put(pid, cur)
        val names = saved.optJSONObject("names")
        if (names != null) {
            val l = out.optJSONObject("settings")?.optJSONArray("playlists")
            if (l != null) for (i in 0 until l.length()) l.optJSONObject(i)?.takeIf { it.optString("id") == pid }?.put("names", names)
        }
        return out
    }

    /** The settings the phone can change in a backup, with their choices (value to label). */
    data class Choice(val key: String, val label: String, val values: List<Pair<Any, String>>, val path: List<String> = listOf(key))
    val CHOICES = listOf(
        Choice("startTab", "Start screen", listOf("guide" to "Guide", "live" to "Channels screen")),
        Choice("textSize", "Text size", listOf("s" to "Small", "m" to "Medium", "l" to "Large")),
        Choice("guideRows", "Guide row size", listOf("m" to "Normal", "l" to "Bigger", "xl" to "Biggest")),
        Choice("showClock", "Clock", listOf(true to "On", false to "Off")),
        Choice("showNumbers", "Channel numbers", listOf(true to "On", false to "Off")),
        Choice("cc", "Closed captions", listOf(true to "On", false to "Off")),
        Choice("adult", "Hide adult channels", listOf(true to "On", false to "Off"), listOf("filter", "adult")),
        Choice("updateAuto", "Check for updates automatically", listOf(true to "On", false to "Off")),
        Choice("exitTwice", "Press Back twice to exit", listOf(true to "On", false to "Off")),
    )

    fun get(b: JSONObject, c: Choice): Any? {
        var o: JSONObject? = b.optJSONObject("settings")
        for (k in c.path.dropLast(1)) o = o?.optJSONObject(k)
        return o?.opt(c.path.last())
    }

    /** A copy of [b] with these settings. */
    fun withSettings(b: JSONObject, values: Map<Choice, Any>): JSONObject {
        val out = copy(b)
        val s = out.optJSONObject("settings") ?: JSONObject().also { out.put("settings", it) }
        values.forEach { (c, v) ->
            var o = s
            for (k in c.path.dropLast(1)) o = o.optJSONObject(k) ?: JSONObject().also { n -> o.put(k, n) }
            o.put(c.path.last(), v)
        }
        return out
    }
}
