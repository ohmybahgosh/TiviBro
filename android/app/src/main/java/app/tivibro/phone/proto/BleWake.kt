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

    /** The service UUID an LG TV advertises itself with (UUID_LECCP_SERVICE in ThinQ). */
    val TV_SERVICE_UUID: UUID = UUID.fromString("0000feb9-0000-1000-8000-00805f9b34fb")

    /** Bytes as lowercase hex, no spaces. */
    fun hex(b: ByteArray?): String = b?.joinToString("") { "%02x".format(it) }.orEmpty()

    /**
     * What an LG TV's advertisement says: its manufacturer data (after company id 196) is an update counter,
     * a byte with the device type (high 4 bits; 3 is a TV) and how many service modules follow (low 4 bits),
     * then one byte per module (id in the high 7 bits, its state in the lowest).  Null when it doesn't fit.
     */
    fun parseAdvert(b: ByteArray?): TvAdvert? {
        if (b == null || b.size < 2) return null
        val n = b[1].toInt() and 0x0F
        if (b.size < 2 + n) return null
        val mods = (0 until n).map { val m = b[2 + it].toInt() and 0xFF; (m shr 1) to (m and 1) }
        return TvAdvert(b[0].toInt() and 0xFF, (b[1].toInt() shr 4) and 0x0F, mods)
    }

    /**
     * The device address an LG TV puts in its own advertisement (AD type 0x1B, LE Bluetooth device address,
     * last six bytes in reverse order, as ThinQ reads it), from the raw scan record, or null.
     */
    fun addressFromRecord(rec: ByteArray?): String? {
        if (rec == null) return null
        var i = 0
        while (i < rec.size) {
            val len = rec[i].toInt() and 0xFF
            if (len == 0 || i + len >= rec.size) break
            if (len >= 7 && (rec[i + 1].toInt() and 0xFF) == 0x1B) {
                val start = i + 1 + len - 6
                val a = ByteArray(6) { rec[start + 5 - it] }
                return a.joinToString(":") { "%02x".format(it) }
            }
            i += len + 1
        }
        return null
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

/** An LG TV's advertisement, as [BleWake.parseAdvert] reads it.  [modules]: (id, state) pairs. */
data class TvAdvert(val update: Int, val deviceType: Int, val modules: List<Pair<Int, Int>>) {
    /** ThinQ's test for a TV that hasn't woken (its wake-up module, 9, in state 0). */
    val wakeOff: Boolean get() = modules.any { it.first == 9 && it.second == 0 }
    override fun toString() = "update $update, type $deviceType, modules " + modules.joinToString(" ") { "${it.first}:${it.second}" }
}

/**
 * Whether the TV came on, from its Bluetooth advertisements while the phone wakes it.  Used only when the phone
 * can't reach the TV over Wi-Fi.  The TV counts as on when an advertisement says its wake-up service isn't off
 * (ThinQ's test), or, once the first [windowMs] are over, when the TV sends an advertisement it wasn't sending
 * at the start (it began advertising, or what it advertises changed).
 */
class TvSeen(private val windowMs: Long = 5000) {
    private val before = mutableSetOf<String>()
    var on = false; private set
    var why = ""; private set
    /** One advertisement [atMs] after the start, its manufacturer data as [hex].  True once the TV counts as on. */
    fun saw(atMs: Long, hex: String, ad: TvAdvert?): Boolean {
        if (on) return true
        when {
            ad != null && !ad.wakeOff -> { on = true; why = "its wake-up service is on" }
            atMs < windowMs -> before += hex
            hex !in before -> { on = true; why = if (before.isEmpty()) "it started advertising" else "its advertisement changed" }
        }
        return on
    }
}

