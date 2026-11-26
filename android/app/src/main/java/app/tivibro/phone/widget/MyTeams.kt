/* The teams the TV follows (My teams), as the Sports widget needs them: learnt from the TV's Sports whenever the app
   (or the widget's refresh, with TiviBro open) reads it.  A team seen there as not followed any more is dropped;
   one that simply has no game this week is kept. */
package app.tivibro.phone.widget

import android.content.Context
import app.tivibro.phone.proto.SportsList
import org.json.JSONArray
import org.json.JSONObject

/** A followed team: TiviBro's id ("nhl:det"), ESPN's id when the TV sent it, and how it looks. */
data class FollowedTeam(val id: String, val eid: String, val abbr: String, val name: String, val logo: String, val color: String) {
    /** Its league ("nhl"): the first part of TiviBro's id. */
    val lg: String get() = id.substringBefore(':')

    fun json(): JSONObject = JSONObject().put("id", id).put("eid", eid).put("abbr", abbr).put("name", name).put("logo", logo).put("color", color)

    companion object {
        fun from(j: JSONObject) = FollowedTeam(j.optString("id"), j.optString("eid"), j.optString("abbr"), j.optString("name"), j.optString("logo"), j.optString("color"))
    }
}

object MyTeams {
    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("my-teams", Context.MODE_PRIVATE)

    fun all(ctx: Context): List<FollowedTeam> = runCatching {
        val a = JSONArray(prefs(ctx).getString("teams", "[]"))
        (0 until a.length()).map { FollowedTeam.from(a.getJSONObject(it)) }
    }.getOrDefault(emptyList())

    private fun save(ctx: Context, l: List<FollowedTeam>) {
        val before = all(ctx).map { it.id }.toSet()
        prefs(ctx).edit().putString("teams", JSONArray().apply { l.forEach { put(it.json()) } }.toString()).apply()
        if (l.map { it.id }.toSet() != before) SportsWidgetWorker.now(ctx)       // the widget shows the new set at once
    }

    /** What the TV's Sports said: its followed teams added or brought up to date, and teams it no longer follows dropped. */
    fun learn(ctx: Context, l: SportsList) {
        save(ctx, merge(all(ctx), l))
        // The channel the TV found for each game (ESPN's id for it), for the Spotlight's Watch on TV.
        val names = channels(ctx).toMutableMap()
        l.rows.flatMap { it.games }.forEach { g -> g.chans.firstOrNull()?.name?.takeIf { it.isNotBlank() }?.let { names[g.id] = it } }
        val keep = names.entries.toList().takeLast(150)
        prefs(ctx).edit().putString("chans", JSONObject().apply { keep.forEach { put(it.key, it.value) } }.toString()).apply()
    }

    /** Game (ESPN's id) to the TV's channel for it, as the TV last said. */
    fun channels(ctx: Context): Map<String, String> = runCatching {
        val j = JSONObject(prefs(ctx).getString("chans", "{}")); j.keys().asSequence().associateWith { j.optString(it) }
    }.getOrDefault(emptyMap())

    /** Pure, for tests: [old] updated from the teams in [l] (each game's teams, followed or not). */
    fun merge(old: List<FollowedTeam>, l: SportsList): List<FollowedTeam> {
        val byId = LinkedHashMap<String, FollowedTeam>(); old.forEach { byId[it.id] = it }
        l.rows.flatMap { it.games }.flatMap { it.teams }.filter { it.id.contains(':') }.forEach { t ->
            if (t.mine) byId[t.id] = FollowedTeam(t.id, t.eid.ifBlank { byId[t.id]?.eid.orEmpty() }, t.abbr, t.name, t.logo, t.color)
            else byId.remove(t.id)
        }
        return byId.values.toList()
    }

    /** A team unfollowed from the phone (its Sports tab). */
    fun forget(ctx: Context, id: String) = save(ctx, all(ctx).filterNot { it.id == id })
}
