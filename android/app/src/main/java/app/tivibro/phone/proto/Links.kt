/* A provider's link shared to the app (from an email, a message or a browser), read the way the TV
   reads it (app/js/links.js), so the app can say what it found before sending it to the TV:
     http://host:8080/get.php?username=a&password=b&type=m3u_plus  ->  Xtream Codes, host:8080, user a
   Any link with a username and password is an Xtream Codes login (get.php, player_api.php, xmltv.php,
   panel_api.php, or a /live/user/pass/1.ts stream link); anything else is an M3U playlist address. */
package app.tivibro.phone.proto

import java.net.URLDecoder

data class ProviderLink(val link: String, val xtream: Boolean, val server: String, val user: String, val bare: Boolean) {
    /** Where it points, without the login: "host:8080". */
    val host: String get() = Regex("^[a-z][a-z0-9+.-]*://([^/?#]+)", RegexOption.IGNORE_CASE).find(if (xtream) server else link)?.groupValues?.get(1) ?: ""

    companion object {
        private fun param(q: String, k: String): String {
            val m = Regex("[?&]$k=([^&#]*)", RegexOption.IGNORE_CASE).find(q) ?: return ""
            return runCatching { URLDecoder.decode(m.groupValues[1], "UTF-8") }.getOrDefault(m.groupValues[1])
        }
        private fun seg(s: String) = runCatching { URLDecoder.decode(s.replace("+", "%2B"), "UTF-8") }.getOrDefault(s)

        fun parse(text: String?): ProviderLink? {
            var s = text?.trim().orEmpty()
            if (s.isEmpty() || s.any { it.isWhitespace() }) return null
            if (!Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(s)) s = "http://$s"
            val m = Regex("^(https?)://([^/?#]+)([^?#]*)(\\?[^#]*)?", RegexOption.IGNORE_CASE).find(s) ?: return null
            val origin = m.groupValues[1].lowercase() + "://" + m.groupValues[2]
            val path = m.groupValues[3]
            val q = m.groupValues[4]
            var user = param(q, "username")
            var pass = param(q, "password")
            var base = ""
            Regex("^(.*?)/(get|player_api|xmltv|panel_api)\\.php$", RegexOption.IGNORE_CASE).find(path)?.let { base = it.groupValues[1] }
            if (user.isEmpty() || pass.isEmpty()) {
                Regex("^(.*?)/(?:live|movie|series)/([^/]+)/([^/]+)/[^/]+$", RegexOption.IGNORE_CASE).find(path)?.let {
                    base = it.groupValues[1]; user = seg(it.groupValues[2]); pass = seg(it.groupValues[3])
                }
            }
            if (user.isNotEmpty() && pass.isNotEmpty()) return ProviderLink(s, true, origin + (if (base.isNotEmpty() && base != "/") base else ""), user, false)
            return ProviderLink(s, false, "", "", q.isEmpty() && (path.isEmpty() || path == "/"))
        }

        /** The first link in shared text ("Your login: http://... Enjoy!"). */
        fun find(text: String?): ProviderLink? {
            if (text.isNullOrBlank()) return null
            Regex("https?://\\S+", RegexOption.IGNORE_CASE).findAll(text).forEach { m -> parse(m.value.trimEnd('.', ',', ')', ']', '>', '"', '\''))?.let { return it } }
            return parse(text.trim())
        }
    }
}
