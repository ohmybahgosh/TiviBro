/* The channel list the web editor showed, kept on the phone so a backup can be edited without the TV
   (OfflineEditorScreen.kt, discussion #23).  Each time the editor opens with a TV (EditorScreen.kt), it
   hands over what it loaded: the playlist's groups and channels (names, logos, numbers, guide ids) and
   the guide's channel names.  It holds no logins and no stream links (service/editor.js keeps those on
   the TV).  One copy per playlist, the newest. */
package app.tivibro.phone.data

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

data class EditorCopy(val pid: String, val name: String, val at: Long, val channels: Int)

class EditorCopies(context: Context) {
    private val root = File(context.applicationContext.filesDir, "editor-copies")
    private fun dir(tvId: String) = File(root, tvId.filter { it.isLetterOrDigit() }).apply { mkdirs() }
    private fun safe(pid: String) = pid.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(60).ifBlank { "p" }

    /** The editor's data as it loaded it (its D), as text. */
    @Synchronized
    fun keep(tvId: String, json: String): EditorCopy? = runCatching {
        val d = JSONObject(json)
        val pl = d.optJSONObject("playlist") ?: return null
        val pid = pl.optString("id").ifBlank { return null }
        val n = d.optJSONArray("channels")?.length() ?: 0
        if (n == 0) return null
        GZIPOutputStream(File(dir(tvId), safe(pid) + ".json.gz").outputStream()).use { it.write(json.toByteArray(Charsets.UTF_8)) }
        val c = EditorCopy(pid, pl.optString("name").ifBlank { "Playlist" }, System.currentTimeMillis(), n)
        val idx = index(tvId)
        idx.put(pid, JSONObject().put("name", c.name).put("at", c.at).put("channels", n))
        File(dir(tvId), "index.json").writeText(idx.toString())
        c
    }.getOrNull()

    private fun index(tvId: String): JSONObject = runCatching { JSONObject(File(dir(tvId), "index.json").readText()) }.getOrElse { JSONObject() }

    fun list(tvId: String): List<EditorCopy> {
        val idx = index(tvId)
        return idx.keys().asSequence().mapNotNull { k -> idx.optJSONObject(k)?.let { EditorCopy(k, it.optString("name"), it.optLong("at"), it.optInt("channels")) } }
            .filter { File(dir(tvId), safe(it.pid) + ".json.gz").exists() }.toList()
    }
    fun has(tvId: String, pid: String) = list(tvId).any { it.pid == pid }

    fun read(tvId: String, pid: String): String =
        GZIPInputStream(File(dir(tvId), safe(pid) + ".json.gz").inputStream()).use { String(it.readBytes(), Charsets.UTF_8) }

    fun forget(tvId: String) { dir(tvId).deleteRecursively() }
}
