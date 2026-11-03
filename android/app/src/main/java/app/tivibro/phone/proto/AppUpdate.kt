/* Is there a newer TiviBro phone app?  The GitHub releases list, the newest one carrying an APK, compared
   with this app's version (issue #33: nothing said a new one was out).  Test builds (0.1.0-dev) never ask. */
package app.tivibro.phone.proto

import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

data class AppRelease(val version: String, val apk: String, val page: String)

object AppUpdate {
    private const val API = "https://api.github.com/repos/ohmybahgosh/TiviBro/releases?per_page=30"

    /** "0.6.0-alpha.64" -> [0, 6, 0, 0, 64]: numbers, then 0 for alpha, 1 for beta, 2 for a final release. */
    fun key(v: String): List<Int>? {
        val m = Regex("^v?(\\d+)\\.(\\d+)\\.(\\d+)(?:-(alpha|beta|rc)\\.(\\d+))?").find(v.trim()) ?: return null
        val g = m.groupValues
        val stage = when (g[4]) { "alpha" -> 0; "beta" -> 1; "rc" -> 2; else -> 3 }
        return listOf(g[1].toInt(), g[2].toInt(), g[3].toInt(), stage, g[5].toIntOrNull() ?: 0)
    }
    fun newer(a: String, b: String): Boolean {
        val x = key(a) ?: return false; val y = key(b) ?: return false
        for (i in x.indices) if (x[i] != y[i]) return x[i] > y[i]
        return false
    }
    /** The newest release with an APK, from the API's answer. */
    fun pick(list: JSONArray): AppRelease? {
        var best: AppRelease? = null
        for (i in 0 until list.length()) {
            val r = list.optJSONObject(i) ?: continue
            if (r.optBoolean("draft")) continue
            val tag = r.optString("tag_name"); if (key(tag) == null) continue
            val assets = r.optJSONArray("assets") ?: continue
            val apk = (0 until assets.length()).mapNotNull { assets.optJSONObject(it) }.firstOrNull { it.optString("name").endsWith(".apk") && !it.optString("name").contains("debug") } ?: continue
            val v = tag.removePrefix("v")
            if (best == null || newer(v, best.version)) best = AppRelease(v, apk.optString("browser_download_url"), r.optString("html_url"))
        }
        return best
    }
    /** A newer release than [current], or null (none, a test build, or no answer). */
    fun check(current: String): AppRelease? {
        if (key(current) == null || current.contains("dev")) return null
        return runCatching {
            val c = URL(API).openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 8000
            c.setRequestProperty("Accept", "application/vnd.github+json")
            c.setRequestProperty("User-Agent", "TiviBro-phone")
            try { if (c.responseCode != 200) null else pick(JSONArray(c.inputStream.bufferedReader().readText())) } finally { c.disconnect() }
        }.getOrNull()?.takeIf { newer(it.version, current) }
    }
}
