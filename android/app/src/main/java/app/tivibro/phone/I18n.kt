/* Languages: the app in the phone's language (on Android 13 and later, the one picked for TiviBro in the
   phone's settings, res/xml/locales_config.xml), with the same dictionaries as the web editor
   (service/editor/lang/<code>.js, put in the APK's assets as editor/lang/).  The English text is the key:
   tr("Settings") is "Ajustes" in Spanish, and anything not translated yet stays English.

   tr("{n} channels hidden", "n" to 3): {n} is a number, {x} {y} {z} any text, filled in English too.  A value
   in the dictionary can be a list, the plural forms of {n}: Spanish [one, other], Russian [one, few, many].
   Spain's Spanish and Portugal's Portuguese are made from the other one with their own words swapped
   (I18n.variant in the files, as on the TV).

   Names (channels, groups, playlists, programmes, teams) never go through tr(): a group called "Sports"
   stays "Sports".  Text from the TV comes in this language already (the app sends it with each ask). */
package app.tivibro.phone

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.Locale

object I18n {
    // langs:begin
    /** The languages TiviBro has, as the TV and the web editor name them (i18n/langs.json, by scripts/i18n-langs.js). */
    val LANGS = listOf("en", "es", "es-ES", "fr", "pt-BR", "pt-PT", "ru", "de", "it", "tr", "pl", "nl")
    /** Languages made from another one with their own words swapped (I18n.variant in the files). */
    val VARIANTS = mapOf("es-ES" to "es", "pt-PT" to "pt-BR")
    /** Each one's plural rule (see [plural]). */
    val PLURAL = mapOf("en" to "one", "es" to "one", "es-ES" to "one", "fr" to "fr", "pt-BR" to "pt", "pt-PT" to "pt", "ru" to "ru", "de" to "one", "it" to "one", "tr" to "one", "pl" to "pl", "nl" to "one")
    // langs:end

    /** The language in use (a code from [LANGS]). */
    @Volatile var lang = "en"; private set
    @Volatile private var dict: Map<String, Any> = emptyMap()

    /** The language for a locale, as on the TV: the exact one when TiviBro has it (es-ES, pt-PT), else the
     *  language (es for es-MX), else its first regional one (pt-BR for pt), else English. */
    fun codeFor(l: Locale): String {
        val c = l.language.lowercase()
        val full = if (l.country.isNotEmpty()) c + "-" + l.country.uppercase() else ""
        return when {
            full in LANGS -> full
            c in LANGS -> c
            else -> LANGS.firstOrNull { it.startsWith("$c-") && it !in VARIANTS } ?: "en"
        }
    }

    /** At start (MainActivity): the phone's language, and its dictionary from the assets.  A missing or broken
     *  file leaves English. */
    fun init(context: Context, locale: Locale = Locale.getDefault()) {
        val code = codeFor(locale)
        val read = { name: String -> runCatching { context.assets.open("editor/lang/$name.js").use { String(it.readBytes(), Charsets.UTF_8) } }.getOrNull() }
        use(code, read)
    }

    @Volatile private var started = false
    /** Outside the app's screen (the Quick Settings tile): the phone's language, once. */
    fun ensure(context: Context) { if (!started) init(context) }

    /** Sets [code] with its dictionary, read by [read] (a file name without .js, its text or null).  Tests call it. */
    fun use(code: String, read: (String) -> String?) {
        val from = VARIANTS[code]
        val d = runCatching {
            when {
                code == "en" || code !in LANGS -> emptyMap()
                from != null -> variant(parseAdd(read(from) ?: ""), read(code) ?: "")
                else -> parseAdd(read(code) ?: "")
            }
        }.getOrDefault(emptyMap())
        dict = d
        lang = if (d.isEmpty()) "en" else code
        started = true
    }

    /** The text in the language, with {n}, {x}... filled from [vars]. */
    fun t(s: String, vararg vars: Pair<String, Any?>): String {
        if (s.isEmpty()) return s
        val v = dict[s] ?: return fill(s, vars)
        val n = vars.firstOrNull { it.first == "n" }?.second
        val text = if (v is List<*>) (v.getOrNull(plural(lang, n)) ?: v.lastOrNull())?.toString() ?: s else v.toString()
        return fill(text, vars)
    }

    /** A sentence with a count: trn(n, "{n} playlist", "{n} playlists").  English picks the one that fits; the
     *  dictionaries have the second, with their own plural forms of {n}. */
    fun tn(n: Number, one: String, many: String, vararg vars: Pair<String, Any?>): String {
        val all = arrayOf<Pair<String, Any?>>("n" to n, *vars)
        return if (dict.containsKey(many)) t(many, *all) else t(if (n.toDouble() == 1.0) one else many, *all)
    }

    private fun fill(s: String, vars: Array<out Pair<String, Any?>>): String {
        if (vars.isEmpty() || !s.contains('{')) return s
        var out = s
        for ((k, v) in vars) out = out.replace("{$k}", v?.toString() ?: "")
        return out
    }

    /** Plural forms (CLDR), as on the TV, by each language's rule ([PLURAL]): one/other; fr and pt 0 and 1
     *  singular; ru one/few/many (1 and 21, 2-4 and 22-24, the rest); pl one/few/many (only 1, 2-4 and 22-24
     *  but not 12-14, the rest).  The index into a list in the dictionary. */
    fun plural(code: String, n: Any?): Int {
        val x = Math.abs(n?.toString()?.replace(Regex("[^\\d.-]"), "")?.toDoubleOrNull() ?: 0.0)
        val i = Math.floor(x).toLong(); val m10 = i % 10; val m100 = i % 100
        val few = m10 in 2..4 && (m100 < 12 || m100 > 14)
        return when (PLURAL[code] ?: "one") {
            "ru" -> if (i.toDouble() != x) 1 else if (m10 == 1L && m100 != 11L) 0 else if (few) 1 else 2
            "pl" -> if (i.toDouble() != x) 1 else if (i == 1L) 0 else if (few) 1 else 2
            "pt" -> if (i <= 1) 0 else 1
            "fr" -> if (x < 2) 0 else 1
            else -> if (x == 1.0) 0 else 1
        }
    }

    /** A dictionary file, I18n.add('es', { ... }): the object, as English text to a translation or a list. */
    fun parseAdd(js: String): Map<String, Any> {
        val src = clean(js)
        val at = src.indexOf('{'); if (at < 0) return emptyMap()
        val o = JSONTokener(src.substring(at)).nextValue() as? JSONObject ?: return emptyMap()
        val out = HashMap<String, Any>(o.length() * 2)
        for (k in o.keys()) {
            val v = o.get(k)
            out[k] = if (v is JSONArray) List(v.length()) { v.optString(it) } else v.toString()
        }
        return out
    }

    /** A language made from another one (I18n.variant('es-ES', 'es', [[word, its word], ...], { ... })): every
     *  translation of [base] with each word swapped (whole words, a capital kept), then the last list on top.
     *  The same rules as app/js/i18n.js, in the same order. */
    fun variant(base: Map<String, Any>, js: String): Map<String, Any> {
        val src = clean(js)
        val at = src.indexOf('['); if (at < 0) return base
        val tok = JSONTokener(src.substring(at))
        val words = tok.nextValue() as JSONArray
        val extra = runCatching { tok.nextClean(); tok.nextValue() as? JSONObject }.getOrNull()
        val letters = "A-Za-zÀ-ÖØ-öø-ÿ"
        val rules = List(words.length()) {
            val w = words.getJSONArray(it)
            Regex("(^|[^$letters])(" + Regex.escape(w.getString(0)) + ")(?=[^$letters]|$)", RegexOption.IGNORE_CASE) to w.getString(1)
        }
        fun swap(x: String): String {
            var s = x
            for ((rx, to) in rules) s = rx.replace(s) { m ->
                val word = m.groupValues[2]
                val t = when {
                    word == word.uppercase() && word != word.lowercase() -> to.uppercase()
                    word[0] != word[0].lowercaseChar() -> to.replaceFirstChar { c -> c.uppercaseChar() }
                    else -> to
                }
                m.groupValues[1] + t
            }
            return s
        }
        val out = HashMap<String, Any>(base.size * 2)
        for ((k, v) in base) out[k] = if (v is List<*>) v.map { swap(it.toString()) } else swap(v.toString())
        if (extra != null) for (k in extra.keys()) { val v = extra.get(k); out[k] = if (v is JSONArray) List(v.length()) { v.optString(it) } else v.toString() }
        return out
    }

    /** The file without its comments (// and /* */ outside strings) and with no comma before a closing } or ],
     *  so org.json reads it.  Strings may be in ' or " (the TV's files use both). */
    private fun clean(js: String): String {
        val b = StringBuilder(js.length)
        var i = 0; var q = 0.toChar()
        while (i < js.length) {
            val c = js[i]
            if (q != 0.toChar()) { b.append(c); if (c == '\\' && i + 1 < js.length) { b.append(js[i + 1]); i += 2; continue }; if (c == q) q = 0.toChar(); i++; continue }
            when {
                c == '"' || c == '\'' -> { q = c; b.append(c); i++ }
                c == '/' && js.startsWith("//", i) -> { while (i < js.length && js[i] != '\n') i++ }
                c == '/' && js.startsWith("/*", i) -> { val e = js.indexOf("*/", i + 2); i = if (e < 0) js.length else e + 2 }
                else -> { b.append(c); i++ }
            }
        }
        return b.toString().replace(Regex(",(\\s*[}\\]])"), "$1")
    }

    /** The web editor's address with this language (?lang=, before the #), so it opens in it too. */
    fun editorUrl(url: String): String {
        if (lang == "en") return url
        val h = url.indexOf('#').let { if (it < 0) url.length else it }
        val head = url.substring(0, h)
        return head + (if (head.contains('?')) "&" else "?") + "lang=" + lang + url.substring(h)
    }
}

/** The text in the app's language (see [I18n]). */
fun tr(s: String, vararg vars: Pair<String, Any?>): String = I18n.t(s, *vars)

/** A sentence with a count in the app's language: trn(n, "{n} playlist", "{n} playlists") (see [I18n.tn]). */
fun trn(n: Number, one: String, many: String, vararg vars: Pair<String, Any?>): String = I18n.tn(n, one, many, *vars)
