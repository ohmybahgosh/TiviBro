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
    fun call(method: String, path: String, body: JSONObject? = null, time: Long? = null): JSONObject {
        val data = body?.toString()?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
        val t = time ?: (System.currentTimeMillis() + tv.offset)
        val nonce = Crypto.nonce()
        val sig = Crypto.hmacHex(tv.key, "tivibro-req-v1\n$method\n$path\n$t\n$nonce\n${Crypto.sha256Hex(data)}")
        val r = http(tv.host, tv.port, method, path, if (body != null) data else null, mapOf(
            "X-TiviBro-Phone" to tv.phoneId, "X-TiviBro-Time" to t.toString(), "X-TiviBro-Nonce" to nonce, "X-TiviBro-Sig" to sig,
        ), timeoutMs)
        val want = Crypto.hmacHex(tv.key, "tivibro-res-v1\n$nonce\n${r.status}\n${Crypto.sha256Hex(r.body)}")
        val j = r.json
        if (r.sig == null || !Crypto.same(r.sig.lowercase(), want)) {
            // The one answer the TV can't sign: it no longer knows this phone.  Anyone could send that, so say so, but keep the TV.
            throw TbException(j?.optString("error")?.ifBlank { null } ?: "The TV's answer was not signed (${r.status}).", j?.optString("code") ?: "", unsigned = true)
        }
        if (j == null) throw TbException("The TV gave an answer TiviBro doesn't understand.", "bad")
        if (r.status >= 400) throw TbException(j.optString("error", "Failed (${r.status})."), j.optString("code"))
        return j
    }

    fun info(): JSONObject = call("GET", "/v1/info")
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
