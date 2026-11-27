/* The phone app's guards from the security audit: pairing links only to TVs on the home network, and the widgets'
   button taps only through a receiver other apps can't reach (the widgets themselves must be exported). */
package app.tivibro.phone

import app.tivibro.phone.proto.PairLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class SecurityTest {
    @Test fun pairingLinksOnlyOnTheHomeNetwork() {
        listOf("192.168.1.20", "10.0.2.2", "172.20.1.5", "169.254.3.4", "100.101.1.2", "livingroom.local", "lgtv", "fe80::1", "fd12::5")
            .forEach { assertTrue(it, PairLink.onHomeNetwork(it)) }
        listOf("8.8.8.8", "172.32.0.1", "evil.example.com", "203.0.113.9", "2001:db8::1", "")
            .forEach { assertFalse(it, PairLink.onHomeNetwork(it)) }
    }

    // In the manifest: the widgets take only the launcher's updates; WidgetTaps (their buttons) isn't exported.
    @Test fun widgetTapsAreNotExported() {
        val m = File("src/main/AndroidManifest.xml").readText()
        val taps = Regex("<receiver[^>]*WidgetTaps[^>]*>").find(m)?.value.orEmpty()
        assertTrue(taps, taps.contains("android:exported=\"false\""))
        val src = File("src/main/java/app/tivibro/phone/widget").listFiles()!!.filter { it.name.endsWith("Widget.kt") }.joinToString("\n") { it.readText() }
        assertEquals("no widget button goes straight to an exported widget", 0, Regex("Intent\\(ctx, (Sports|Remote)Widget::class\\.java\\)\\.setAction").findAll(src).count())
    }
}
