/* Is there a newer TiviBro phone app?  The GitHub releases list, the newest one carrying an APK, compared
   with this app's version (issue #33: nothing said a new one was out).  Test builds (0.1.0-dev) never ask.
   Also fetches that APK for an update in place (update/Updater.kt installs it): https only, with its size
   and, when GitHub gives one, its SHA-256 checked before anything is installed. */
package app.tivibro.phone.proto

import org.json.JSONArray
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CancellationException

/** A release's APK: [size] in bytes (0 when unknown) and [sha256] in lowercase hex (null when GitHub gave none). */
data class AppRelease(val version: String, val apk: String, val page: String, val size: Long = 0, val sha256: String? = null)

object AppUpdate {
    private const val API = "https://api.github.com/repos/ohmybahgosh/TiviBro/releases?per_page=30"
    /** The most a download may be when neither GitHub nor the server says how big it is. */
    private const val MAX_UNKNOWN = 200L * 1024 * 1024

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
    /** GitHub's asset "digest" ("sha256:<64 hex>") as lowercase hex, or null for anything else. */
    fun digest(d: String?): String? {
        val t = d?.trim() ?: return null
        if (!t.startsWith("sha256:", ignoreCase = true)) return null
        val hex = t.substring(7).lowercase()
        return hex.takeIf { it.length == 64 && it.all { c -> c in '0'..'9' || c in 'a'..'f' } }
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
            val sha = if (apk.isNull("digest")) null else digest(apk.optString("digest"))
            val size = apk.optLong("size", 0L).coerceAtLeast(0L)
            if (best == null || newer(v, best.version)) best = AppRelease(v, apk.optString("browser_download_url"), r.optString("html_url"), size, sha)
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

    /** A file's SHA-256 in lowercase hex. */
    fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { inp ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = inp.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
    /** What's wrong with a downloaded [f] for release [r] (its size, then its SHA-256 when known), or null when it matches. */
    fun problem(f: File, r: AppRelease): String? {
        if (!f.isFile || f.length() == 0L) return "The download is empty."
        if (r.size > 0 && f.length() != r.size) return "The download is the wrong size (${f.length()} bytes, expected ${r.size})."
        val want = r.sha256 ?: return null
        return if (sha256(f) == want) null else "The download doesn't match the release's fingerprint."
    }

    /** Opens [start], following up to 5 redirects, all over https; returns the connection that answered 200. */
    private fun open(start: String): HttpURLConnection {
        var url = URL(start)
        repeat(6) {
            if (url.protocol != "https") throw IOException("The download link isn't secure (https).")
            val c = url.openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 15000; c.readTimeout = 20000
            c.setRequestProperty("Accept", "application/octet-stream")
            c.setRequestProperty("User-Agent", "TiviBro-phone")
            val code = try { c.responseCode } catch (e: IOException) { c.disconnect(); throw e }
            if (code == 200) return c
            val loc = c.getHeaderField("Location")
            c.disconnect()
            if (code !in 300..399 || loc.isNullOrBlank()) throw IOException("GitHub answered $code.")
            url = URL(url, loc)
        }
        throw IOException("Too many redirects.")
    }

    /** Saves release [r]'s APK as [dest] (through a .part file), reporting bytes done and the total (0 when
     *  unknown), stopping with a CancellationException as soon as [keepGoing] says no, and checking the size
     *  and SHA-256 when known.  Anything else (not https, not 200, too big, wrong size or fingerprint) throws
     *  an IOException with a plain message and leaves no file behind. */
    fun download(r: AppRelease, dest: File, keepGoing: () -> Boolean, progress: (Long, Long) -> Unit) {
        dest.parentFile?.mkdirs()
        val part = File(dest.path + ".part")
        part.delete(); dest.delete()
        try {
            val c = open(r.apk)
            try {
                val len = c.contentLengthLong
                if (r.size > 0 && len >= 0 && len != r.size) throw IOException("The download is the wrong size ($len bytes, expected ${r.size}).")
                val total = if (r.size > 0) r.size else len.coerceAtLeast(0L)
                val cap = if (total > 0) total else MAX_UNKNOWN
                c.inputStream.use { inp ->
                    part.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        var done = 0L
                        progress(0L, total)
                        while (true) {
                            if (!keepGoing()) throw CancellationException("Cancelled")
                            val n = inp.read(buf)
                            if (n < 0) break
                            done += n
                            if (done > cap) throw IOException("The download is bigger than expected.")
                            out.write(buf, 0, n)
                            progress(done, total)
                        }
                    }
                }
            } finally { c.disconnect() }
            problem(part, r)?.let { throw IOException(it) }
            if (!part.renameTo(dest)) throw IOException("Couldn't save the download.")
        } catch (e: Throwable) {
            part.delete(); dest.delete()
            throw e
        }
    }
}
