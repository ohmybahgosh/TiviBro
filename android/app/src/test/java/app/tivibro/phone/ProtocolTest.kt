package app.tivibro.phone

import app.tivibro.phone.proto.Crypto
import app.tivibro.phone.proto.PairLink
import app.tivibro.phone.proto.Tv
import app.tivibro.phone.proto.Wol
import app.tivibro.phone.proto.editorUrlOk
import app.tivibro.phone.proto.splitHostPort
import app.tivibro.phone.proto.unb64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The same values the TV's helper (service/companion.js, Node) produces. */
class ProtocolTest {
    private val hex = { b: ByteArray -> b.joinToString("") { "%02x".format(it) } }

    @Test fun pairKeyMatchesTheTv() {
        val kp = Crypto.pairKey("abcd efgh-jkmn", "0123456789abcdef")
        assertEquals("572f119c4b8cf3e5abd8a7969bf151db4c110befec24df7d970dd0d457c92766", hex(kp))
        assertEquals("4da7c1171c74b317b6dfc9b19640dec6ba176c7f2ee924d98411eee2d403bb1c",
            Crypto.hmacHex(kp, "tivibro-pair-v1\n0123456789abcdef\nNONCE123456789abcdef\nPixel 8"))
    }

    @Test fun phoneKeyOpens() {
        val kp = Crypto.pairKey("ABCD-EFGH-JKMN", "0123456789abcdef")
        val key = Crypto.openKey(kp, unb64("AAECAwQFBgcICQoL"), unb64("uOWw2WA3RJQlYmyo/xxy8m0s4qW7xiRmVbOWHNVk+9Q="), unb64("Wu+WZ1ONLOtG6KsiMMROuA=="), "a1b2c3d4e5f6")
        assertArrayEquals(ByteArray(32) { 0x11 }, key)
    }

    @Test(expected = Exception::class) fun phoneKeyRefusesAnotherPhoneId() {
        val kp = Crypto.pairKey("ABCD-EFGH-JKMN", "0123456789abcdef")
        Crypto.openKey(kp, unb64("AAECAwQFBgcICQoL"), unb64("uOWw2WA3RJQlYmyo/xxy8m0s4qW7xiRmVbOWHNVk+9Q="), unb64("Wu+WZ1ONLOtG6KsiMMROuA=="), "ffffffffffff")
    }

    @Test fun bodyHash() = assertEquals("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a", Crypto.sha256Hex("{}".toByteArray()))

    @Test fun codes() {
        assertEquals("ABCDEFGHJKMN", Crypto.normCode(" abcd-efgh jkmn "))
        assertEquals("ABCD-EFGH-JKMN", Crypto.showCode("abcdefghjkmn"))
        assertEquals("ABCD-EF", Crypto.showCode("abcdef"))
    }

    @Test fun pairLinks() {
        val l = PairLink.parse("https://tivibro.app/pair#v=1&h=192.168.50.96%3A47810&id=3f9c0a7d12e4b6c8&c=ABCDEFGHJKMN&n=Living%20room")
        assertNotNull(l)
        assertEquals("192.168.50.96", l!!.host); assertEquals(47810, l.port); assertEquals("ABCDEFGHJKMN", l.code); assertEquals("Living room", l.name)
        val l2 = PairLink.parse("tivibro://pair?v=1&h=10.0.0.5%3A47816&id=3f9c0a7d12e4b6c8&c=ABCDEFGHJKMN&n=Den")
        assertEquals(47816, l2!!.port)
        assertNull(PairLink.parse("https://example.com/pair#h=1.2.3.4&id=3f9c0a7d12e4b6c8&c=ABCDEFGHJKMN"))
        assertNull(PairLink.parse("https://tivibro.app/pair#h=1.2.3.4&id=3f9c0a7d12e4b6c8&c=SHORT"))
        assertNull(PairLink.parse("https://tivibro.app/pair#h=evil host&id=3f9c0a7d12e4b6c8&c=ABCDEFGHJKMN"))
    }

    @Test fun addresses() {
        assertEquals("192.168.1.20" to 47810, splitHostPort("192.168.1.20"))
        assertEquals("tv.local" to 8000, splitHostPort("tv.local:8000"))
        assertNull(splitHostPort("http://x"))
    }

    @Test fun editorUrls() {
        val tv = Tv("0123456789abcdef", "TV", "192.168.1.20", 47810, "a1b2c3d4e5f6", ByteArray(32))
        assertTrue(editorUrlOk("http://192.168.1.20:8787/#t=" + "a".repeat(48), tv))
        assertFalse(editorUrlOk("http://evil.example:8787/#t=" + "a".repeat(48), tv))
        assertFalse(editorUrlOk("javascript:alert(1)", tv))
    }

    @Test fun wakePacket() {
        val p = Wol.packet(Wol.macBytes("a8:23:fe:01:02:03")!!)
        assertEquals(102, p.size)
        assertEquals(0xFF.toByte(), p[0]); assertEquals(0xa8.toByte(), p[6]); assertEquals(0x03.toByte(), p[101])
        assertNull(Wol.macBytes("not a mac"))
    }

    @Test fun tvRoundTrip() {
        val tv = Tv("0123456789abcdef", "Living room", "192.168.1.20", 47810, "a1b2c3d4e5f6", ByteArray(32) { it.toByte() }, offset = -1234, mac = "a8:23:fe:01:02:03")
        val back = Tv.fromJson(tv.toJson())
        assertEquals(tv, back); assertArrayEquals(tv.key, back.key); assertEquals(-1234, back.offset); assertEquals(tv.mac, back.mac)
    }
}
