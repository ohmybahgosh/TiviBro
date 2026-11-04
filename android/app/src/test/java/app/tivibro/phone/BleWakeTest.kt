package app.tivibro.phone

import app.tivibro.phone.proto.BleWake
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
}
