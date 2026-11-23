package app.tivibro.phone

import app.tivibro.phone.ui.subtitleText
import org.junit.Assert.assertEquals
import org.junit.Test

/** Sending a subtitle file to the TV: the file's bytes read as text the way most .srt files are written. */
class SubtitleTextTest {
    @Test fun utf8WithBomKeepsAccentsAndDropsTheBom() {
        val bytes = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "1\nCafé\n".toByteArray(Charsets.UTF_8)
        assertEquals("1\nCafé\n", subtitleText(bytes))
    }

    @Test fun windows1252WhenItIsNotUtf8() {
        val bytes = "Ça va\n".toByteArray(charset("windows-1252"))
        assertEquals("Ça va\n", subtitleText(bytes))
    }
}
