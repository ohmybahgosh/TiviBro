/* What a few of TiviBro's answers hold, for the phone's own screens: a question the TV would have shown on
   its own screen (a box to type in, a menu, an "are you sure"), now asked on the phone instead (the
   Settings tab); the reminders still to come (the Reminders screen); and the restore points kept on the
   TV (Backups and restore points).  See app/js/phone.js and app/js/settings.js on the TV. */
package app.tivibro.phone.proto

import org.json.JSONObject

/** A question from the TV.  [kind] is prompt, menu or confirm. */
data class TvDialog(
    val id: String, val kind: String, val title: String,
    val value: String = "", val hint: String = "", val secret: Boolean = false, val ok: String = "",
    val items: List<Item> = emptyList(),
) {
    data class Item(val label: String, val sub: String, val current: Boolean)

    /** What the answer carries besides op, sec and path. */
    fun answer(value: String) = JSONObject().put("dialog", id).put("value", value)
    fun choose(index: Int) = JSONObject().put("dialog", id).put("choice", index)
    fun yes() = JSONObject().put("dialog", id)
    fun cancel() = JSONObject().put("dialog", id).put("cancel", true)

    companion object {
        val KINDS = setOf("prompt", "menu", "confirm")

        /** The question in a reply, or null when there is none (or one this app doesn't know). */
        fun from(reply: JSONObject?): TvDialog? {
            val d = reply?.optJSONObject("dialog") ?: return null
            val id = d.optString("id").takeIf { it.isNotBlank() } ?: return null
            val kind = d.optString("kind")
            if (kind !in KINDS) return null
            val items = d.optJSONArray("items")?.let { a ->
                (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { Item(it.str("label"), it.str("sub"), it.optBoolean("current")) }
            }.orEmpty()
            return TvDialog(id, kind, d.str("title"), d.str("value"), d.str("hint"), d.optBoolean("secret"), d.str("ok"), items)
        }
    }
}

/** One reminder: channel [k] at [start] ([live] once it has started).  [watch] is the watchlist word or
    team that set it ("" when set by hand). */
data class Reminder(
    val k: String, val channel: String, val logo: String, val start: Long, val end: Long, val title: String,
    val watch: String, val live: Boolean,
) {
    /** "From your watchlist: X", "From My teams" (a team you follow: the TV sends its id, not its name),
        or "" when it was set by hand. */
    val from: String get() = when {
        watch.isBlank() -> ""
        watch.startsWith("team:") -> "From My teams"
        else -> "From your watchlist: $watch"
    }

    companion object {
        fun list(j: JSONObject): List<Reminder> {
            val a = j.optJSONArray("items") ?: return emptyList()
            return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.mapNotNull { r ->
                val k = r.str("k").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                Reminder(k, r.str("ch"), r.str("logo"), r.optLong("s"), r.optLong("e"), r.str("t"), r.str("w"), r.optInt("live") == 1 || r.optBoolean("live"))
            }.sortedBy { it.start }
        }
    }
}

/** A restore point on the TV: a copy of its channel edits and names, made by hand ([named]) or by itself. */
data class RestorePoint(val id: String, val name: String, val at: Long, val kind: String) {
    val auto: Boolean get() = kind == "auto"

    companion object {
        fun list(j: JSONObject): List<RestorePoint> {
            val a = j.optJSONArray("items") ?: return emptyList()
            return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.mapNotNull { s ->
                val id = s.str("id").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                RestorePoint(id, s.str("name"), s.optLong("at"), s.str("kind"))
            }.sortedByDescending { it.at }
        }
    }
}

/** A string field, with JSON null and a missing field both as "". */
private fun JSONObject.str(k: String): String = if (isNull(k)) "" else optString(k)

/** The editor's address from the TV (…/#t=TOKEN), opened on one of its pages ([page], an editor page id
    such as "gc" or "history").  Anything else leaves the address as it is (the editor's first page). */
fun editorPageUrl(url: String, page: String): String =
    if (Regex("^\\w{1,30}$").matches(page) && Regex("#t=[0-9a-f]{48}$").containsMatchIn(url)) "$url/$page" else url
