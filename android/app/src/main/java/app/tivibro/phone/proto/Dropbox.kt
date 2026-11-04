/* Dropbox sign-in for My media: authorization code with PKCE (no app secret anywhere).  The phone opens
   Dropbox's sign-in page, catches the redirect to https://tivibro.app/dropbox (or tivibro://dropbox from
   that page's button), swaps the code for a refresh token here, and hands only the refresh token to the TV
   (ask "mymedia", ops dbfolders and adddropbox, sealed).  The TV never sees the code or the verifier.
   Nothing here is logged: the code, the verifier and the token are secrets. */
package app.tivibro.phone.proto

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** What Dropbox sent back to the redirect address: a code and our state, or an error. */
data class DropboxRedirect(val code: String, val state: String, val error: String)

object Dropbox {
    /** The TiviBro Dropbox app's key (public: PKCE apps have no secret). */
    const val KEY = "ax8fum67966pyg6"
    /** Registered with Dropbox exactly like this. */
    const val REDIRECT = "https://tivibro.app/dropbox"
    private const val AUTHORIZE = "https://www.dropbox.com/oauth2/authorize"
    private const val TOKEN = "https://api.dropboxapi.com/oauth2/token"

    private val random = SecureRandom()
    private fun b64url(b: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    /** 64 random URL-safe characters (48 random bytes, base64url). */
    fun verifier(): String = ByteArray(48).also { random.nextBytes(it) }.let { b64url(it) }

    /** S256: base64url (no padding) of the SHA-256 of the verifier. */
    fun challenge(verifier: String): String = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    /** A random state, checked when Dropbox sends the code back. */
    fun state(): String = ByteArray(16).also { random.nextBytes(it) }.let { b64url(it) }

    /** Dropbox's sign-in page, asking for a refresh token (offline). */
    fun authorizeUrl(challenge: String, state: String): String =
        "$AUTHORIZE?client_id=$KEY&response_type=code&token_access_type=offline&code_challenge=${enc(challenge)}&code_challenge_method=S256" +
            "&redirect_uri=${enc(REDIRECT)}&state=${enc(state)}"

    /** Is this link Dropbox's redirect (https://tivibro.app/dropbox?... or tivibro://dropbox?...)?  Null if not. */
    fun redirect(link: String?): DropboxRedirect? {
        val s = link?.trim().orEmpty()
        val m = Regex("^(?:tivibro://dropbox|https://tivibro\\.app/dropbox)/?(?:\\?([^#]*))?(?:#.*)?$", RegexOption.IGNORE_CASE).find(s) ?: return null
        val q = m.groupValues[1]
        fun param(k: String): String {
            q.split('&').forEach { p ->
                val i = p.indexOf('=')
                val name = if (i < 0) p else p.substring(0, i)
                if (name == k) return runCatching { URLDecoder.decode(if (i < 0) "" else p.substring(i + 1), "UTF-8") }.getOrDefault("")
            }
            return ""
        }
        return DropboxRedirect(param("code"), param("state"), param("error"))
    }

    /** What to say for an error Dropbox put in the redirect. */
    fun redirectError(error: String): String =
        if (error == "access_denied") "Dropbox sign-in was cancelled.  Nothing was added."
        else "Dropbox didn't finish the sign-in.  Try again."

    /** The form sent to swap the code for tokens. */
    fun exchangeForm(code: String, verifier: String): String =
        "grant_type=authorization_code&code=${enc(code)}&client_id=$KEY&code_verifier=${enc(verifier)}&redirect_uri=${enc(REDIRECT)}"

    /** Reads Dropbox's token answer: the refresh token, or a plain message to show. */
    fun refreshFrom(status: Int, body: String): String {
        val j = runCatching { JSONObject(body) }.getOrNull()
        if (status == 200) {
            val r = j?.optString("refresh_token").orEmpty()
            if (r.isNotBlank()) return r
            throw TbException("Dropbox didn't send a lasting sign-in.  Try again.", "dropbox")
        }
        val err = j?.optString("error").orEmpty()
        throw TbException(when (err) {
            "invalid_grant" -> "Dropbox didn't accept that sign-in (it may have taken too long).  Sign in again."
            "invalid_client", "unauthorized_client" -> "Dropbox didn't accept TiviBro's sign-in.  Update the TiviBro phone app and try again."
            else -> "Dropbox said no (${if (err.isNotBlank()) err else "error $status"}).  Try again in a minute."
        }, "dropbox")
    }

    /** Swaps the code for tokens at Dropbox and returns the refresh token (the access token is not kept). */
    fun exchange(code: String, verifier: String, timeoutMs: Int = 20_000): String {
        val body = exchangeForm(code, verifier).toByteArray(Charsets.UTF_8)
        val (status, text) = try {
            val c = URL(TOKEN).openConnection() as HttpURLConnection
            try {
                c.requestMethod = "POST"
                c.connectTimeout = timeoutMs; c.readTimeout = timeoutMs
                c.useCaches = false
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                c.setRequestProperty("User-Agent", "TiviBro-phone")
                c.outputStream.use { it.write(body) }
                val st = c.responseCode
                val stream = if (st >= 400) c.errorStream else c.inputStream
                st to (stream?.use { it.bufferedReader().readText() } ?: "")
            } finally { c.disconnect() }
        } catch (e: IOException) {
            throw TbException("Couldn't reach Dropbox.  Is the phone online?", "unreachable")
        }
        return refreshFrom(status, text)
    }
}
