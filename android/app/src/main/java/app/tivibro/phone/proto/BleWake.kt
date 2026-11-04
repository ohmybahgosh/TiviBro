/* Turning the TV on over Bluetooth (Wake on BLE), as LG's ThinQ app does: the bytes of the advertisement
   and the phone's made-up Bluetooth address.  Plain JVM code, unit tested.  The advertising itself is in
   ble/BleWaker.kt, the TV side in service/blewake.js. */
package app.tivibro.phone.proto

import java.security.SecureRandom
import java.util.Random
import java.util.UUID

object BleWake {
    /** LG Electronics' Bluetooth company id (196), for the manufacturer data. */
    const val LG_COMPANY_ID = 0x00C4

    /** The service UUID LG's TVs listen for (UUID_LECCP_CONTROL in ThinQ). */
    val SERVICE_UUID: UUID = UUID.fromString("0000feba-0000-1000-8000-00805f9b34fb")

    /** How long the phone advertises before giving up, as ThinQ does. */
    const val ADVERTISE_MS = 60_000L

    private val ADDRESS = Regex("^([0-9a-f]{2}:){5}[0-9a-f]{2}$")

    fun isAddress(s: String?): Boolean = s != null && ADDRESS.matches(s)

    /** "aa:bb:cc:dd:ee:ff" to 6 bytes in the string's order, or null. */
    fun addressBytes(s: String?): ByteArray? {
        val t = s?.trim()?.lowercase() ?: return null
        if (!isAddress(t)) return null
        return ByteArray(6) { t.substring(it * 3, it * 3 + 2).toInt(16).toByte() }
    }

    /**
     * The manufacturer data (after LG's company id): the phone's address, then the control data
     * [length 7, control id 0, the TV's Bluetooth address].  14 bytes, or null when either address is bad.
     */
    fun manufacturerData(phone: String, tv: String): ByteArray? {
        val p = addressBytes(phone) ?: return null
        val t = addressBytes(tv) ?: return null
        return p + byteArrayOf(7, 0) + t
    }

    /**
     * A made-up address for this phone, made once and kept (ThinQ never uses the phone's real one): six random
     * bytes, the first marked locally administered and unicast (so it is never all zeros).
     */
    fun newAddress(rnd: Random = SecureRandom()): String {
        val b = ByteArray(6).also { rnd.nextBytes(it) }
        b[0] = ((b[0].toInt() and 0xFC) or 0x02).toByte()
        return b.joinToString(":") { "%02x".format(it) }
    }
}
