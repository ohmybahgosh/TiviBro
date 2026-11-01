/* The phone side of the pairing and request protocol (docs/wiki/Phone-app-protocol.md): reading pairing
   links, PBKDF2 and HMAC for pairing, opening the TV's AES-GCM key delivery, and signing every request
   and checking every answer.  Plain JVM code, unit tested against the TV's real service/companion.js. */
package app.tivibro.phone.proto

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * The TiviBro phone app protocol (docs/wiki/Phone-app-protocol.md, service/companion.js on the TV).
 * Plain JVM code, so the unit tests run it against the real helper.
 */
const val DEFAULT_PORT = 47810
const val DISCOVER = "tivibro-discover-v1"
private const val KDF_ITER = 100_000

class TbException(message: String, val code: String = "", val unsigned: Boolean = false) : Exception(message)

/** A paired TV, as the app keeps it. */
data class Tv(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    val phoneId: String,
    val key: ByteArray,
    val offset: Long = 0,
    val model: String = "",
    val mac: String = "",
    val version: String = "",
    val added: Long = System.currentTimeMillis(),
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("name", name).put("host", host).put("port", port).put("phone", phoneId)
        .put("key", b64(key)).put("offset", offset).put("model", model).put("mac", mac).put("version", version).put("added", added)

    companion object {
        fun fromJson(j: JSONObject) = Tv(
            id = j.getString("id"), name = j.optString("name", "TV"), host = j.getString("host"), port = j.optInt("port", DEFAULT_PORT),
            phoneId = j.getString("phone"), key = unb64(j.getString("key")), offset = j.optLong("offset", 0),
            model = j.optString("model", ""), mac = j.optString("mac", ""), version = j.optString("version", ""), added = j.optLong("added", 0),
        )
    }

    override fun equals(other: Any?) = other is Tv && other.id == id && other.phoneId == phoneId && other.host == host && other.name == name
    override fun hashCode() = id.hashCode()
}

/** What the QR code on the TV carries: https://tivibro.app/pair#v=1&h=ip:port&id=..&c=CODE&n=name (or tivibro://pair?...). */
data class PairLink(val host: String, val port: Int, val id: String, val code: String, val name: String) {
    companion object {
        fun parse(text: String?): PairLink? {
            if (text.isNullOrBlank()) return null
            val t = text.trim()
            val query = when {
                t.startsWith("https://tivibro.app/pair#") -> t.substringAfter('#')
                t.startsWith("tivibro://pair?") -> t.substringAfter('?').substringBefore('#')
                else -> return null
            }
            val q = query.split('&').mapNotNull { kv ->
                val i = kv.indexOf('=')
                if (i <= 0) null else kv.substring(0, i) to URLDecoder.decode(kv.substring(i + 1), "UTF-8")
            }.toMap()
            val hp = q["h"] ?: return null
            val code = Crypto.normCode(q["c"] ?: return null)
            val id = q["id"] ?: return null
            if (code.length != 12 || !Regex("^[0-9a-f]{16}$").matches(id)) return null
            val (host, port) = splitHostPort(hp) ?: return null
            return PairLink(host, port, id, code, (q["n"] ?: "TV").take(40))
        }
    }
}

fun splitHostPort(s: String): Pair<String, Int>? {
    val t = s.trim()
    if (t.isEmpty()) return null
    val i = t.lastIndexOf(':')
    val host = if (i > 0) t.substring(0, i) else t
    val port = if (i > 0) t.substring(i + 1).toIntOrNull() ?: return null else DEFAULT_PORT
    if (!Regex("^[A-Za-z0-9.\\-]+$").matches(host) || port !in 1..65535) return null
    return host to port
}

fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
fun unb64(s: String): ByteArray = Base64.getDecoder().decode(s)

object Crypto {
    private val rnd = SecureRandom()

    /** The code as typed: any case, spaces and dashes. */
    fun normCode(s: String): String = s.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' }

    /** XXXX-XXXX-XXXX for showing. */
    fun showCode(s: String): String = normCode(s).chunked(4).joinToString("-")

    fun pairKey(code: String, tvId: String): ByteArray {
        val spec = PBEKeySpec(normCode(code).toCharArray(), "tivibro-pair-v1:$tvId".toByteArray(Charsets.UTF_8), KDF_ITER, 256)
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    }

    fun hmacHex(key: ByteArray, text: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return hex(mac.doFinal(text.toByteArray(Charsets.UTF_8)))
    }

    fun sha256Hex(b: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(b))

    /** The phone's key, as the TV sends it: AES-256-GCM under the stretched code, with the phone id as additional data. */
    fun openKey(kp: ByteArray, iv: ByteArray, data: ByteArray, tag: ByteArray, phoneId: String): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(kp, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD("tivibro-key-v1\n$phoneId".toByteArray(Charsets.UTF_8))
        return c.doFinal(data + tag)
    }

    fun nonce(): String { val b = ByteArray(18); rnd.nextBytes(b); return b64(b) }

    fun same(a: String, b: String): Boolean = MessageDigest.isEqual(a.toByteArray(), b.toByteArray())

    /* Sealed bodies (logins, backups): AES-256-GCM under a key made from the phone's key, bound to the
       phone and the request's nonce.  The TV answers a sealed request with a sealed answer. */
    private fun sealKey(key: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256"); mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal("tivibro-seal-v1".toByteArray(Charsets.UTF_8))
    }
    private fun sealAad(dir: String, phoneId: String, nonce: String) = "tivibro-seal-$dir-v1\n$phoneId\n$nonce".toByteArray(Charsets.UTF_8)

    fun seal(obj: JSONObject, key: ByteArray, dir: String, phoneId: String, nonce: String): JSONObject {
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(sealKey(key), "AES"), GCMParameterSpec(128, iv))
        c.updateAAD(sealAad(dir, phoneId, nonce))
        val out = c.doFinal(obj.toString().toByteArray(Charsets.UTF_8))
        return JSONObject().put("iv", b64(iv)).put("data", b64(out.copyOfRange(0, out.size - 16))).put("tag", b64(out.copyOfRange(out.size - 16, out.size)))
    }

    fun unseal(box: JSONObject, key: ByteArray, dir: String, phoneId: String, nonce: String): JSONObject {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(sealKey(key), "AES"), GCMParameterSpec(128, unb64(box.getString("iv"))))
        c.updateAAD(sealAad(dir, phoneId, nonce))
        return JSONObject(String(c.doFinal(unb64(box.getString("data")) + unb64(box.getString("tag"))), Charsets.UTF_8))
    }

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
}

/** One HTTP exchange with a TV. */
internal class Reply(val status: Int, val body: ByteArray, val sig: String?) {
    val json: JSONObject? by lazy { runCatching { JSONObject(String(body, Charsets.UTF_8)) }.getOrNull() }
}

internal fun http(host: String, port: Int, method: String, path: String, body: ByteArray?, headers: Map<String, String> = emptyMap(), timeoutMs: Int = 8000): Reply {
    val url = URL("http", host, port, path)
    val c = url.openConnection() as HttpURLConnection
    try {
        c.requestMethod = method
        c.connectTimeout = timeoutMs
        c.readTimeout = timeoutMs
        c.useCaches = false
        c.instanceFollowRedirects = false
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            // Not streaming mode: the JVM's HttpURLConnection then throws on a 401 instead of returning it.
            c.outputStream.use { it.write(body) }
        }
        val status = c.responseCode
        val stream = if (status >= 400) c.errorStream else c.inputStream
        val out = ByteArrayOutputStream()
        stream?.use { it.copyTo(out) }
        return Reply(status, out.toByteArray(), c.getHeaderField("X-TiviBro-Sig"))
    } finally {
        c.disconnect()
    }
}

data class Hello(val id: String, val name: String, val version: String, val pairing: Boolean, val now: Long, val api: Int)

object Pairing {
    fun hello(host: String, port: Int, timeoutMs: Int = 4000): Hello {
        val r = http(host, port, "GET", "/v1/hello", null, timeoutMs = timeoutMs)
        val j = r.json
        if (r.status != 200 || j == null || j.optString("app") != "TiviBro") throw TbException("No TiviBro at $host:$port", "missing")
        return Hello(j.getString("id"), j.optString("name", "TV"), j.optString("version", ""), j.optBoolean("pairing"), j.optLong("now"), j.optInt("api", 1))
    }

    /** Pair with the code shown on the TV.  The code itself is never sent. */
    fun pair(host: String, port: Int, code: String, phoneName: String, phoneModel: String, expectId: String? = null): Tv {
        val h = hello(host, port)
        if (expectId != null && h.id != expectId) throw TbException("That address is a different TV.", "other")
        val kp = Crypto.pairKey(code, h.id)
        val nonce = Crypto.nonce()
        val name = phoneName.take(40).ifBlank { "Phone" }
        val body = JSONObject()
            .put("nonce", nonce)
            .put("phone", JSONObject().put("name", name).put("model", phoneModel.take(40)).put("platform", "android"))
            .put("proof", Crypto.hmacHex(kp, "tivibro-pair-v1\n${h.id}\n$nonce\n$name"))
        val r = http(host, port, "POST", "/v1/pair", body.toString().toByteArray(Charsets.UTF_8))
        val j = r.json ?: throw TbException("The TV gave an answer TiviBro doesn't understand.", "bad")
        if (r.status != 200) throw TbException(j.optString("error", "Pairing failed (${r.status})."), j.optString("code"))
        val phoneId = j.getString("phone")
        if (!Crypto.same(j.optString("proof"), Crypto.hmacHex(kp, "tivibro-paired-v1\n$phoneId\n$nonce")))
            throw TbException("The TV did not prove it knows the code.  Is this the right TV?", "proof")
        val k = j.getJSONObject("key")
        val key = Crypto.openKey(kp, unb64(k.getString("iv")), unb64(k.getString("data")), unb64(k.getString("tag")), phoneId)
        val tv = j.getJSONObject("tv")
        return Tv(id = tv.getString("id"), name = tv.optString("name", h.name), host = host, port = port, phoneId = phoneId, key = key,
            offset = h.now - System.currentTimeMillis(), version = tv.optString("version", ""))
    }
}

sealed class EditorState {
    data class Ready(val url: String) : EditorState()
    data class Starting(val message: String) : EditorState()
}

/** Signed calls to a paired TV.  Every answer must carry the TV's signature. */
class TvClient(private val tv: Tv, private val timeoutMs: Int = 8000) {
    fun call(method: String, path: String, body: JSONObject? = null, time: Long? = null): JSONObject = call(method, path, body, time, Crypto.nonce(), null)

    private fun call(method: String, path: String, body: JSONObject?, time: Long?, nonce: String, open: ((JSONObject) -> JSONObject)?): JSONObject {
        val data = body?.toString()?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
        val t = time ?: (System.currentTimeMillis() + tv.offset)
        val sig = Crypto.hmacHex(tv.key, "tivibro-req-v1\n$method\n$path\n$t\n$nonce\n${Crypto.sha256Hex(data)}")
        val r = http(tv.host, tv.port, method, path, if (body != null) data else null, mapOf(
            "X-TiviBro-Phone" to tv.phoneId, "X-TiviBro-Time" to t.toString(), "X-TiviBro-Nonce" to nonce, "X-TiviBro-Sig" to sig,
        ), timeoutMs)
        val want = Crypto.hmacHex(tv.key, "tivibro-res-v1\n$nonce\n${r.status}\n${Crypto.sha256Hex(r.body)}")
        val raw = r.json
        if (r.sig == null || !Crypto.same(r.sig.lowercase(), want)) {
            val j = raw
            // The one answer the TV can't sign: it no longer knows this phone.  Anyone could send that, so say so, but keep the TV.
            throw TbException(j?.optString("error")?.ifBlank { null } ?: "The TV's answer was not signed (${r.status}).", j?.optString("code") ?: "", unsigned = true)
        }
        // A sealed answer is opened here (errors from before the TV could open the request come back plain).
        val j = if (raw != null && open != null && raw.has("sealed")) open(raw.getJSONObject("sealed")) else raw
        if (j == null) throw TbException("The TV gave an answer TiviBro doesn't understand.", "bad")
        if (r.status >= 400) throw TbException(j.optString("error", "Failed (${r.status})."), j.optString("code"))
        return j
    }

    /**
     * A question for TiviBro on the TV (POST /v1/ask): the guide, movies and shows, favorites, reminders,
     * typing, adding a playlist, backups.  [seal] for logins and backups.  The answer is { ok, data },
     * or { pending } when TiviBro didn't answer in time, or { closed } with [noOpen] and TiviBro closed.
     */
    fun ask(what: String, args: JSONObject = JSONObject(), seal: Boolean = false, noOpen: Boolean = false): JSONObject {
        val body = JSONObject().put("what", what).put("args", args)
        if (noOpen) body.put("noOpen", true)
        if (!seal) return call("POST", "/v1/ask", body)
        val nonce = Crypto.nonce()
        return call("POST", "/v1/ask", JSONObject().put("sealed", Crypto.seal(body, tv.key, "req", tv.phoneId, nonce)), null, nonce) { box ->
            Crypto.unseal(box, tv.key, "res", tv.phoneId, nonce)
        }
    }

    fun info(): JSONObject = call("GET", "/v1/info")
    fun key(k: String) { call("POST", "/v1/key", JSONObject().put("key", k)) }
    fun action(a: String) { call("POST", "/v1/action", JSONObject().put("action", a)) }
    fun play(k: String) { call("POST", "/v1/play", JSONObject().put("k", k)) }
    fun text(t: String) { call("POST", "/v1/text", JSONObject().put("text", t)) }
    fun volume(dir: String): Volume? = call("POST", "/v1/volume", JSONObject().put("dir", dir)).optJSONObject("volume")?.let { Volume(it.optInt("level", -1), it.optBoolean("muted")) }
    /** What TiviBro shows.  With [wait], the TV answers when it changes (or after 20 seconds). */
    fun state(since: Int, wait: Boolean): NowState = NowState.from(call("GET", "/v1/state?since=$since" + if (wait) "&wait=1" else ""))
    fun lineup(rev: Int): JSONObject = call("GET", "/v1/lineup?rev=$rev")
    fun open() { call("POST", "/v1/open", JSONObject()) }
    fun forget() { call("POST", "/v1/forget", JSONObject()) }
    fun editor(): EditorState {
        val j = call("POST", "/v1/editor", JSONObject())
        return when (j.optString("state")) {
            "ready" -> EditorState.Ready(j.getString("url"))
            "starting" -> EditorState.Starting(j.optString("message", "Starting the editor on the TV…"))
            else -> throw TbException(j.optString("error", "The TV could not start the editor."), "editor")
        }
    }
}

/** The editor address the TV gives must point at this TV's address. */
fun editorUrlOk(url: String, tv: Tv): Boolean = runCatching {
    val u = URI(url)
    u.scheme == "http" && u.host == tv.host && Regex("^t=[0-9a-f]{48}(/\\w+)?$").matches(u.rawFragment ?: "")
}.getOrDefault(false)

data class Volume(val level: Int, val muted: Boolean)

data class Prog(val title: String, val start: Long, val end: Long) {
    companion object { fun from(j: JSONObject?) = j?.optString("t")?.takeIf { it.isNotBlank() }?.let { Prog(it, j.optLong("s"), j.optLong("e")) } }
}

/** What TiviBro on the TV is showing (GET /v1/state). */
data class NowState(
    val rev: Int, val open: Boolean, val tab: String = "", val full: Boolean = false,
    val channelKey: String = "", val channel: String = "", val number: String = "", val logo: String = "", val group: String = "",
    val now: Prog? = null, val next: Prog? = null, val paused: Boolean = false,
    val vodTitle: String = "", val vodPos: Int = 0, val vodDur: Int = 0,
    val inputs: List<TvInput> = emptyList(),
    /** TiviBro is open but busy (a huge playlist, a big clean-up): presses wait until it's done. */
    val busy: Boolean = false,
    /** Whether the provider has movies and shows; null from an older TiviBro (then both tabs show). */
    val movies: Boolean? = null, val series: Boolean? = null,
) {
    companion object {
        fun from(j: JSONObject): NowState {
            val s = j.optJSONObject("state")
            val p = s?.optJSONObject("playing")
            val v = s?.optJSONObject("vod")
            return NowState(
                rev = j.optInt("rev"), open = j.optBoolean("open"), tab = s?.optString("tab").orEmpty(), full = s?.optBoolean("full") == true,
                channelKey = p?.optString("k").orEmpty(), channel = p?.optString("name").orEmpty(), number = p?.opt("num")?.toString().orEmpty(),
                logo = p?.optString("logo").orEmpty(), group = p?.optString("group").orEmpty(),
                now = Prog.from(s?.optJSONObject("now")), next = Prog.from(s?.optJSONObject("next")), paused = s?.optBoolean("paused") == true,
                vodTitle = v?.optString("title").orEmpty(), vodPos = v?.optInt("pos") ?: 0, vodDur = v?.optInt("dur") ?: 0,
                busy = j.optBoolean("busy"),
                movies = s?.optJSONObject("vod2")?.optBoolean("movies"), series = s?.optJSONObject("vod2")?.optBoolean("series"),
                inputs = s?.optJSONArray("inputs")?.let { a -> (0 until a.length()).mapNotNull { TvInput.from(a.optJSONObject(it)) } }.orEmpty(),
            )
        }
    }
}

/** [inAll]: false for a channel only a group shows (a Local channels group keeps stations whose network groups are hidden). */
data class Chan(val k: String, val name: String, val number: String, val logo: String, val fav: Boolean, val now: Prog?, val inAll: Boolean = true)
data class Group(val id: String, val name: String, val keys: List<String>)
data class Lineup(val rev: Int, val channels: List<Chan>, val groups: List<Group>) {
    val byKey: Map<String, Chan> by lazy { channels.associateBy { it.k } }
    /** What the TV's All shows. */
    val all: List<Chan> by lazy { channels.filter { it.inAll } }
    companion object {
        fun from(j: JSONObject): Lineup? {
            val cs = j.optJSONArray("channels") ?: return null
            val gs = j.optJSONArray("groups")
            val chans = (0 until cs.length()).map { i ->
                val c = cs.getJSONObject(i)
                Chan(c.getString("k"), c.optString("n"), c.opt("num")?.toString().orEmpty(), c.optString("logo"), c.optInt("fav") == 1, Prog.from(c.optJSONObject("now")), c.optInt("na") != 1)
            }
            val groups = if (gs == null) emptyList() else (0 until gs.length()).map { i ->
                val g = gs.getJSONObject(i); val ks = g.optJSONArray("keys")
                Group(g.optString("id"), g.optString("name"), if (ks == null) emptyList() else (0 until ks.length()).map { ks.getString(it) })
            }
            return Lineup(j.optInt("rev"), chans, groups)
        }
    }
}

/** A text box on the TV's screen right now (set-up, search, a rename), that the phone can type into.  A password's text never comes to the phone. */
data class TvInput(val id: Int, val label: String, val type: String, val value: String, val filled: Boolean, val canSubmit: Boolean, val focused: Boolean) {
    val secret get() = type == "password"
    companion object {
        fun from(j: JSONObject?): TvInput? = j?.takeIf { it.has("id") }?.let {
            TvInput(it.optInt("id"), it.optString("label", "Text"), it.optString("type", "text"), it.optString("value", ""), it.optInt("has") == 1 || it.optString("value").isNotEmpty(), it.optInt("submit") == 1, it.optInt("focus") == 1)
        }
    }
}
