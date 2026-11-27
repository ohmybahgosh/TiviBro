package app.tivibro.phone

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.util.Locale

/** The phone app's languages (I18n.kt), read from the same files as the web editor (service/editor/lang). */
class I18nTest {
    // The dictionaries in the repository, as the APK carries them (editor/lang/<code>.js).
    private val dir = listOf("../../service/editor/lang", "../service/editor/lang", "service/editor/lang").map(::File).first { it.isDirectory }
    private val read = { name: String -> File(dir, "$name.js").takeIf { it.exists() }?.readText() }

    @After fun english() = I18n.use("en", read)

    @Test fun localeToLanguage() {
        assertEquals("es-ES", I18n.codeFor(Locale("es", "ES")))
        assertEquals("es", I18n.codeFor(Locale("es", "MX")))
        assertEquals("pt-PT", I18n.codeFor(Locale("pt", "PT")))
        assertEquals("pt-BR", I18n.codeFor(Locale("pt")))
        assertEquals("ru", I18n.codeFor(Locale("ru", "RU")))
        assertEquals("de", I18n.codeFor(Locale("de", "AT")))
        assertEquals("en", I18n.codeFor(Locale("ko", "KR")))
    }

    @Test fun englishFillsPlaceholders() {
        I18n.use("en", read)
        assertEquals("Settings", tr("Settings"))
        assertEquals("3 h", tr("{n} h", "n" to 3))
        assertEquals("1 playlist", trn(1, "{n} playlist", "{n} playlists"))
        assertEquals("2 playlists", trn(2, "{n} playlist", "{n} playlists"))
    }

    @Test fun spanishFromTheEditorsFile() {
        I18n.use("es", read)
        assertEquals("es", I18n.lang)
        assertEquals("Configuración", tr("Settings"))
        assertEquals("Text nobody translated", tr("Text nobody translated"))
    }

    @Test fun russianPluralForms() {
        assertEquals(0, I18n.plural("ru", 1)); assertEquals(0, I18n.plural("ru", 21))
        assertEquals(1, I18n.plural("ru", 3)); assertEquals(2, I18n.plural("ru", 11)); assertEquals(2, I18n.plural("ru", 5))
        assertEquals(0, I18n.plural("fr", 0)); assertEquals(0, I18n.plural("pt-BR", 1)); assertEquals(1, I18n.plural("es", 0))
        assertEquals(0, I18n.plural("ar", 0)); assertEquals(2, I18n.plural("ar", 2)); assertEquals(3, I18n.plural("ar", 10))
        assertEquals(4, I18n.plural("ar", 11)); assertEquals(5, I18n.plural("ar", 100)); assertEquals(3, I18n.plural("ar", 103))
        I18n.use("ru", read)
        assertEquals("21 изменение", trn(21, "{n} change", "{n} changes"))
        assertEquals("3 изменения", trn(3, "{n} change", "{n} changes"))
        assertEquals("5 изменений", trn(5, "{n} change", "{n} changes"))
    }

    @Test fun parseAndVariant() {
        val d = I18n.parseAdd("/* a comment */ I18n.add('es', { 'Edit': \"Editar\", // more\n  \"{n} h\": ['{n} hora', '{n} horas'], });")
        assertEquals("Editar", d["Edit"])
        assertEquals(listOf("{n} hora", "{n} horas"), d["{n} h"])
        val v = I18n.variant(mapOf("Computer" to "La computadora", "Phone" to "Celular"), "I18n.variant('es-ES', 'es', [['computadora', 'ordenador'], ['celular', 'móvil']], { 'Edit': 'Editar' });")
        assertEquals("La ordenador", v["Computer"])
        assertEquals("Móvil", v["Phone"])
        assertEquals("Editar", v["Edit"])
    }

    @Test fun spainAndPortugalBuiltFromTheirBase() {
        I18n.use("es-ES", read)
        assertEquals("es-ES", I18n.lang)
        I18n.use("pt-PT", read)
        assertEquals("pt-PT", I18n.lang)
        I18n.use("xx", read)
        assertEquals("en", I18n.lang)
    }

    @Test fun editorAddressCarriesTheLanguage() {
        I18n.use("fr", read)
        assertEquals("http://tv:8787/?lang=fr#settings", I18n.editorUrl("http://tv:8787/#settings"))
        assertEquals("http://tv:8787/?pw=1&lang=fr", I18n.editorUrl("http://tv:8787/?pw=1"))
        I18n.use("en", read)
        assertEquals("http://tv:8787/#x", I18n.editorUrl("http://tv:8787/#x"))
    }
}
