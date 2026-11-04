package app.tivibro.phone

import app.tivibro.phone.proto.BleWake
import app.tivibro.phone.proto.TvSeen
import org.junit.Assert.assertFalse
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

/** The LG wake advertisement (as ThinQ sends it) and the phone's made-up Bluetooth address. */
class BleWakeTest {
    private fun bytes(vararg v: Int) = ByteArray(v.size) { v[it].toByte() }

    @Test fun manufacturerData() {
        assertArrayEquals(
            bytes(0x02, 0x11, 0x22, 0x33, 0x44, 0x55, 0x07, 0x00, 0x80, 0x5b, 0x65, 0xa8, 0xf5, 0xc1),
            BleWake.manufacturerData("02:11:22:33:44:55", "80:5b:65:a8:f5:c1"),
        )
        // The TV's address as the helper may send it, in capitals.
        assertEquals(14, BleWake.manufacturerData("02:11:22:33:44:55", "80:5B:65:A8:F5:C1")!!.size)
    }

    @Test fun badAddressesGiveNothing() {
        assertNull(BleWake.manufacturerData("02:11:22:33:44", "80:5b:65:a8:f5:c1"))
        assertNull(BleWake.manufacturerData("02:11:22:33:44:55", "80-5b-65-a8-f5-c1"))
        assertNull(BleWake.manufacturerData("02:11:22:33:44:55", ""))
        assertNull(BleWake.addressBytes("zz:11:22:33:44:55"))
    }

    @Test fun lgIds() {
        assertEquals(196, BleWake.LG_COMPANY_ID)
        assertEquals("0000feba-0000-1000-8000-00805f9b34fb", BleWake.SERVICE_UUID.toString())
    }

    @Test fun madeUpAddress() {
        val rnd = Random(42)
        val seen = HashSet<String>()
        repeat(500) {
            val a = BleWake.newAddress(rnd)
            assertTrue(a, BleWake.isAddress(a))
            val first = a.substring(0, 2).toInt(16)
            assertEquals("locally administered, unicast: $a", 0x02, first and 0x03)
            assertNotEquals("00:00:00:00:00:00", a)
            seen += a
        }
        assertTrue(seen.size > 490)
        // Every first byte is turned into a local unicast one, even all ones or all zeros.
        assertEquals("fe:ff:ff:ff:ff:ff", BleWake.newAddress(object : Random() { override fun nextBytes(b: ByteArray) { b.fill(0xFF.toByte()) } }))
        assertEquals("02:00:00:00:00:00", BleWake.newAddress(object : Random() { override fun nextBytes(b: ByteArray) { b.fill(0) } }))
    }

    /** What the C2 advertised while on (heard from a computer nearby): 03 34 14 12 16 fd 80. */
    @Test fun readsTheTvsAdvertisement() {
        val ad = BleWake.parseAdvert(bytes(0x03, 0x34, 0x14, 0x12, 0x16, 0xfd, 0x80))!!
        assertEquals(3, ad.update)
        assertEquals(3, ad.deviceType)
        assertEquals(listOf(10 to 0, 9 to 0, 11 to 0, 126 to 1), ad.modules)
        assertTrue(ad.wakeOff)
        assertFalse(BleWake.parseAdvert(bytes(0x03, 0x31, 0x13))!!.wakeOff)
        assertNull(BleWake.parseAdvert(bytes(0x03, 0x34, 0x14)))
        assertNull(BleWake.parseAdvert(null))
        assertEquals("0334", BleWake.hex(bytes(0x03, 0x34)))
    }

    @Test fun readsTheAddressInTheScanRecord() {
        // Flags, then AD type 0x1B: address type byte, then the address backwards.
        val rec = bytes(0x02, 0x01, 0x06, 0x08, 0x1b, 0x00, 0xc1, 0xf5, 0xa8, 0x65, 0x5b, 0x80, 0x00)
        assertEquals("80:5b:65:a8:f5:c1", BleWake.addressFromRecord(rec))
        assertNull(BleWake.addressFromRecord(bytes(0x02, 0x01, 0x06)))
        assertNull(BleWake.addressFromRecord(bytes(0x09, 0x1b, 0x00)))
    }

    @Test fun tellsTheTvCameOn() {
        val standby = "0334141216fd80"
        // Advertising the same thing all along: never on.
        val same = TvSeen()
        assertFalse(same.saw(500, standby, BleWake.parseAdvert(bytes(0x03, 0x34, 0x14, 0x12, 0x16, 0xfd, 0x80))))
        assertFalse(same.saw(20_000, standby, BleWake.parseAdvert(bytes(0x03, 0x34, 0x14, 0x12, 0x16, 0xfd, 0x80))))
        // Silent at first, then advertising: on.
        val appears = TvSeen()
        assertTrue(appears.saw(8_000, standby, BleWake.parseAdvert(bytes(0x03, 0x34, 0x14, 0x12, 0x16, 0xfd, 0x80))))
        assertEquals("it started advertising", appears.why)
        // Something new in the first seconds only joins what it sent before.
        val early = TvSeen()
        assertFalse(early.saw(1_000, standby, BleWake.parseAdvert(bytes(0x03, 0x34, 0x14, 0x12, 0x16, 0xfd, 0x80))))
        assertTrue(early.saw(9_000, "0434141216fd80", BleWake.parseAdvert(bytes(0x04, 0x34, 0x14, 0x12, 0x16, 0xfd, 0x80))))
        assertEquals("its advertisement changed", early.why)
        // The wake-up module on: on at once (ThinQ's test).
        assertTrue(TvSeen().saw(100, "0331130", BleWake.parseAdvert(bytes(0x03, 0x31, 0x13))))
    }
}
