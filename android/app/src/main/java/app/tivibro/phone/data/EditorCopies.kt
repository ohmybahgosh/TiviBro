/* The channel list the web editor showed, kept on the phone so a backup can be edited without the TV
   (OfflineEditorScreen.kt, discussion #23).  Each time the editor opens with a TV (EditorScreen.kt), it
   hands over what it loaded: the playlist's groups and channels (names, logos, numbers, guide ids) and
   the guide's channel names.  It holds no logins and no stream links (service/editor.js keeps those on
   the TV).  One copy per playlist, the newest.
   It arrives in pieces (begin, part, end): the editor gzips it and sends a few hundred KB at a time, so a
   list of 186,000 channels gets through too, and is written to storage as it comes, never held whole. */
package app.tivibro.phone.data

import android.content.Context
import org.json.JSONObject
import android.util.Base64
import java.io.File
import java.io.OutputStream
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream

data class EditorCopy(val pid: String, val name: String, val at: Long, val channels: Int)

class EditorCopies(context: Context) {
    private val root = File(context.applicationContext.filesDir, "editor-copies")
    private fun dir(tvId: String) = File(root, tvId.filter { it.isLetterOrDigit() }).apply { mkdirs() }
    private fun safe(pid: String) = pid.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(60).ifBlank { "p" }

    private class Incoming(val tvId: String, val pid: String, val name: String, val channels: Int, val gz: Boolean, val tmp: File, val out: OutputStream)
    private var incoming: Incoming? = null
    private fun drop() { incoming?.let { runCatching { it.out.close() }; it.tmp.delete() }; incoming = null }

    /** A copy starts: what it is ({pid, name, channels, gz}).  Says whether it is wanted. */
    @Synchronized
    fun begin(tvId: String, meta: String): Boolean = runCatching {
        drop()
        val m = JSONObject(meta)
        val pid = m.optString("pid"); val n = m.optInt("channels")
        if (pid.isBlank() || n <= 0) return false
        val tmp = File(dir(tvId), safe(pid) + ".part")
        val raw = tmp.outputStream().buffered(256 * 1024)
        val gz = m.optBoolean("gz")
        incoming = Incoming(tvId, pid, m.optString("name").ifBlank { "Playlist" }, n, gz, tmp, if (gz) raw else GZIPOutputStream(raw))
        true
    }.getOrElse { drop(); false }

    /** The next piece: base64 of gzipped bytes, or plain text when the editor couldn't gzip. */
    @Synchronized
    fun part(chunk: String): Boolean {
        val i = incoming ?: return false
        return runCatching { if (i.gz) i.out.write(Base64.decode(chunk, Base64.DEFAULT)) else i.out.write(chunk.toByteArray(Charsets.UTF_8)); true }.getOrElse { drop(); false }
    }

    /** The copy is complete: checked, and put in place of the last one for that playlist. */
    @Synchronized
    fun end(): EditorCopy? {
        val i = incoming ?: return null
        incoming = null
        return runCatching {
            i.out.close()
            val first = GZIPInputStream(i.tmp.inputStream()).use { s -> var c: Int; do { c = s.read() } while (c == ' '.code || c == '\n'.code); c }
            if (first != '{'.code) { i.tmp.delete(); return null }
            val f = file(i.tvId, i.pid)
            if (!i.tmp.renameTo(f)) { i.tmp.copyTo(f, overwrite = true); i.tmp.delete() }
            val c = EditorCopy(i.pid, i.name, System.currentTimeMillis(), i.channels)
            val idx = index(i.tvId)
            idx.put(i.pid, JSONObject().put("name", c.name).put("at", c.at).put("channels", c.channels))
            File(dir(i.tvId), "index.json").writeText(idx.toString())
            c
        }.getOrElse { i.tmp.delete(); null }
    }

    fun file(tvId: String, pid: String) = File(dir(tvId), safe(pid) + ".json.gz")

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
