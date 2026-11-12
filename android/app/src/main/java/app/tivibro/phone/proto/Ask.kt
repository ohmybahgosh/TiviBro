/* What TiviBro on the TV answers to the phone's questions (POST /v1/ask, see app/js/phone.js): the
   guide a page of channels at a time, one channel's schedule, Movies and Shows (categories, titles,
   details with seasons and episodes).  Plain JVM code, read from the TV's JSON. */
package app.tivibro.phone.proto

import org.json.JSONArray
import org.json.JSONObject

private inline fun <T> JSONArray?.list(f: (JSONObject) -> T?): List<T> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it)?.let(f) }

/** A programme in the guide.  [reminder] when a reminder is set for it on the TV. */
data class Programme(val title: String, val start: Long, val end: Long, val desc: String = "", val reminder: Boolean = false, val movie: ProgMovie? = null) {
    fun on(now: Long) = start <= now && end > now
    companion object {
        fun from(j: JSONObject) = j.optString("t").takeIf { it.isNotBlank() }?.let {
            Programme(it, j.optLong("s"), j.optLong("e"), j.optString("d", ""), j.optInt("r") == 1,
                j.optJSONObject("m")?.let { m -> ProgMovie(m.optString("i"), m.optString("y"), m.optString("g"), m.optString("r"), m.optString("k") == "s", m.optString("n")) })
        }
    }
}

/** A guide programme the TV found to be a movie (TMDB, with its token): poster, year, genres, rating. */
/** TMDB's facts for a guide programme: a movie, or a TV show ([series], with its [network]). */
data class ProgMovie(val poster: String, val year: String, val genre: String, val rating: String, val series: Boolean = false, val network: String = "") {
    val facts get() = (if (series) listOf("Series", if (year.isNotBlank()) "since $year" else "", network, genre, if (rating.isNotBlank()) "★ $rating" else "")
        else listOf("Movie", year, genre, if (rating.isNotBlank()) "★ $rating" else "")).filter { it.isNotBlank() }.joinToString("  ·  ")
}

/** Movies on now: one movie, and the channels showing it ([OnNowChan]). */
data class OnNowChan(val key: String, val name: String, val logo: String, val start: Long, val end: Long, val reminder: Boolean)
data class OnNowMovie(val id: String, val title: String, val year: String, val genre: String, val runtime: String, val rating: String, val plot: String,
                      val poster: String, val backdrop: String, val logo: String, val live: Boolean, val chans: List<OnNowChan>) {
    val first get() = chans.first()
    val facts get() = listOf(year, runtime, genre, if (rating.isNotBlank()) "★ $rating" else "").filter { it.isNotBlank() }.joinToString("  ·  ")
}
/** A genre shelf: its name and its movies, each as "id|on" or "id|soon" (the TV picks them, Movies.genres). */
data class OnNowGenre(val title: String, val ids: List<String>)
data class OnNow(val off: Boolean, val msg: String, val on: List<OnNowMovie>, val soon: List<OnNowMovie>, val looking: Boolean, val genres: List<OnNowGenre> = emptyList()) {
    /** The genre shelves with their movies (an older TV sends none). */
    fun genreShelves(): List<Pair<String, List<OnNowMovie>>> {
        val by = (on.map { it.id + "|on" to it } + soon.map { it.id + "|soon" to it }).toMap()
        return genres.map { g -> g.title to g.ids.mapNotNull { by[it] } }.filter { it.second.isNotEmpty() }
    }
    companion object {
        private fun movie(j: JSONObject) = OnNowMovie(j.optString("id"), j.optString("title"), j.optString("year"), j.optString("genre"), j.optString("runtime"), j.optString("rating"),
            j.optString("plot"), j.optString("poster"), j.optString("backdrop"), j.optString("logo"), j.optInt("live") == 1,
            j.optJSONArray("chans").list { OnNowChan(it.optString("k"), it.optString("n"), it.optString("logo"), it.optLong("s"), it.optLong("e"), it.optInt("r") == 1) }).takeIf { it.chans.isNotEmpty() }
        fun from(j: JSONObject) = OnNow(j.optBoolean("off"), j.optString("msg"), j.optJSONArray("on").list { movie(it) }, j.optJSONArray("soon").list { movie(it) }, j.optInt("looking") == 1,
            j.optJSONArray("genres").list { g -> OnNowGenre(g.optString("t"), g.optJSONArray("ids")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()) })
    }
}

/** One channel's row in the guide: what is on at the time asked for, and the two after.  [progs] is null while the TV is still loading its guide.
 *  [dead]: the channel's last tries on the TV failed (issue #37). */
data class GuideRow(val key: String, val progs: List<Programme>?, val catchup: Boolean, val dead: Boolean = false)

data class GuidePage(val total: Int, val offset: Int, val rows: List<GuideRow>, val pending: Int) {
    companion object {
        fun from(j: JSONObject) = GuidePage(j.optInt("total"), j.optInt("offset"),
            j.optJSONArray("rows").list { r -> GuideRow(r.getString("k"), r.optJSONArray("p")?.let { a -> a.list { Programme.from(it) } }, r.optInt("a") == 1, r.optInt("dead") == 1) },
            j.optInt("pending"))
    }
}

/** A channel's programmes from as far back as catch-up goes to a week ahead. */
data class Schedule(val key: String, val progs: List<Programme>, val catchupDays: Int, val pending: Boolean, val descPending: Boolean) {
    companion object {
        /** Programmes with no time of their own are left out, and only the first of any at the same start is
         *  kept: the schedule lists them by start, and two at once crashed the app (a guide with CNN's
         *  "Special Program" and "Election Day in America" both at 9:00). */
        fun from(j: JSONObject) = Schedule(j.optString("k"), clean(j.optJSONArray("progs").list { Programme.from(it) }), j.optInt("arch"), j.optBoolean("pending"), j.optBoolean("descPending"))
        fun clean(progs: List<Programme>): List<Programme> = progs.filter { it.end > it.start }.distinctBy { it.start }
    }
}

/** One channel as the TV has it, for the phone's long press (ask "chan"): its name, whether you renamed or
    hid it, its provider group, and your own groups with whether it is in each. */
data class ChanGroup(val id: String, val name: String, val has: Boolean)
data class ChanTeam(val id: String, val name: String, val on: Boolean)
data class ChanEdit(val key: String, val name: String, val provider: String, val renamed: Boolean, val hidden: Boolean, val group: String, val groups: List<ChanGroup>, val msg: String, val team: ChanTeam? = null) {
    companion object {
        fun from(j: JSONObject) = ChanEdit(j.optString("k"), j.optString("name"), j.optString("provider"), j.optBoolean("renamed"), j.optBoolean("hidden"), j.optString("group"),
            j.optJSONArray("groups").list { ChanGroup(it.optString("id"), it.optString("name"), it.optInt("has") == 1) }, j.optString("msg"),
            j.optJSONObject("team")?.let { ChanTeam(it.optString("id"), it.optString("name"), it.optInt("on") == 1) })
    }
}

/** Show or hide channels in one group: every channel, hidden ones too ([on] false), [guide] when it has guide data. */
data class VisRow(val key: String, val name: String, val number: String, val logo: String, val on: Boolean, val guide: Boolean)
data class VisList(val group: String, val title: String, val rows: List<VisRow>) {
    companion object {
        fun from(j: JSONObject) = VisList(j.optString("group"), j.optString("title"),
            j.optJSONArray("rows").list { VisRow(it.optString("k"), it.optString("n"), it.optString("num"), it.optString("logo"), it.optInt("on") == 1, it.optInt("g") == 1) })
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
