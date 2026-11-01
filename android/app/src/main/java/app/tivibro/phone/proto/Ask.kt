/* What TiviBro on the TV answers to the phone's questions (POST /v1/ask, see app/js/phone.js): the
   guide a page of channels at a time, one channel's schedule, Movies and Shows (categories, titles,
   details with seasons and episodes).  Plain JVM code, read from the TV's JSON. */
package app.tivibro.phone.proto

import org.json.JSONArray
import org.json.JSONObject

private inline fun <T> JSONArray?.list(f: (JSONObject) -> T?): List<T> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(f) }

/** A programme in the guide.  [reminder] when a reminder is set for it on the TV. */
data class Programme(val title: String, val start: Long, val end: Long, val desc: String = "", val reminder: Boolean = false) {
    fun on(now: Long) = start <= now && end > now
    companion object {
        fun from(j: JSONObject) = j.optString("t").takeIf { it.isNotBlank() }?.let {
            Programme(it, j.optLong("s"), j.optLong("e"), j.optString("d", ""), j.optInt("r") == 1)
        }
    }
}

/** One channel's row in the guide: what is on at the time asked for, and the two after.  [progs] is null while the TV is still loading its guide. */
data class GuideRow(val key: String, val progs: List<Programme>?, val catchup: Boolean)

data class GuidePage(val total: Int, val offset: Int, val rows: List<GuideRow>, val pending: Int) {
    companion object {
        fun from(j: JSONObject) = GuidePage(j.optInt("total"), j.optInt("offset"),
            j.optJSONArray("rows").list { r -> GuideRow(r.getString("k"), r.optJSONArray("p")?.let { a -> a.list { Programme.from(it) } }, r.optInt("a") == 1) },
            j.optInt("pending"))
    }
}

/** A channel's programmes from as far back as catch-up goes to a week ahead. */
data class Schedule(val key: String, val progs: List<Programme>, val catchupDays: Int, val pending: Boolean, val descPending: Boolean) {
    companion object {
        fun from(j: JSONObject) = Schedule(j.optString("k"), j.optJSONArray("progs").list { Programme.from(it) }, j.optInt("arch"), j.optBoolean("pending"), j.optBoolean("descPending"))
    }
}

/** One channel as the TV has it, for the phone's long press (ask "chan"): its name, whether you renamed or
    hid it, its provider group, and your own groups with whether it is in each. */
data class ChanGroup(val id: String, val name: String, val has: Boolean)
data class ChanEdit(val key: String, val name: String, val provider: String, val renamed: Boolean, val hidden: Boolean, val group: String, val groups: List<ChanGroup>, val msg: String) {
    companion object {
        fun from(j: JSONObject) = ChanEdit(j.optString("k"), j.optString("name"), j.optString("provider"), j.optBoolean("renamed"), j.optBoolean("hidden"), j.optString("group"),
            j.optJSONArray("groups").list { ChanGroup(it.optString("id"), it.optString("name"), it.optInt("has") == 1) }, j.optString("msg"))
    }
}

/* ---------- Movies and Shows ---------- */

data class VodCat(val id: String, val name: String, val count: Int, val locked: Boolean)

/** A movie or a show in a list.  [progress] is how far a movie was watched, in percent (0 when not started). */
data class VodItem(val id: String, val name: String, val cover: String, val rating: String, val year: String, val progress: Int) {
    companion object {
        fun from(j: JSONObject) = VodItem(j.opt("id")?.toString() ?: "", j.optString("n"), j.optString("c"), j.optString("r"), j.optString("y"), j.optInt("p"))
    }
}

data class VodPage(val total: Int, val offset: Int, val items: List<VodItem>, val locked: Boolean) {
    companion object {
        fun from(j: JSONObject) = VodPage(j.optInt("total"), j.optInt("offset"), j.optJSONArray("items").list { VodItem.from(it) }, j.optBoolean("locked"))
    }
}

data class Episode(val id: String, val number: Int, val title: String, val duration: String, val plot: String, val pos: Int, val len: Int) {
    val progress get() = if (len > 0) (100 * pos / len).coerceIn(0, 100) else 0
}
data class Season(val number: Int, val episodes: List<Episode>)

/** A movie's or a show's details.  [pos] and [len] (seconds) say where a movie was stopped. */
data class VodInfo(
    val id: String, val name: String, val cover: String, val plot: String, val genre: String, val cast: String, val year: String,
    val duration: String, val rating: String, val media: String, val pos: Int, val len: Int, val seasons: List<Season>,
) {
    companion object {
        fun from(j: JSONObject) = VodInfo(
            j.opt("id")?.toString() ?: "", j.optString("n"), j.optString("c"), j.optString("plot"), j.optString("genre"), j.optString("cast"), j.optString("year"),
            j.optString("dur"), j.optString("r"), j.optString("media"), j.optInt("pos"), j.optInt("len"),
            j.optJSONArray("seasons").list { s ->
                Season(s.optInt("s"), s.optJSONArray("eps").list { e ->
                    Episode(e.opt("id")?.toString() ?: "", e.optInt("e"), e.optString("t"), e.optString("dur"), e.optString("plot"), e.optInt("pos"), e.optInt("len"))
                })
            },
        )
    }
}
