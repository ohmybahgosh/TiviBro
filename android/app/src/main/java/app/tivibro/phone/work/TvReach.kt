/* Reaching a TV from the background (the Quick Settings tile, a reminder's Watch on TV, the Sports widget):
   the TV turned on first when it is off, with Wake-on-LAN and, when already allowed, LG's Bluetooth wake
   packet (nothing is asked from the background). */
package app.tivibro.phone.work

import android.content.Context
import app.tivibro.phone.ble.BleWaker
import app.tivibro.phone.proto.BleWake
import app.tivibro.phone.proto.Pairing
import app.tivibro.phone.proto.Tv
import app.tivibro.phone.proto.Wol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay

object TvReach {
    /** Work that must outlive what started it: Android lets go of a tile, a receiver or a widget's tap within
     *  seconds, and work tied to them was cancelled before the TV was asked. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Does [tv] answer, after waking it when it doesn't?  False when it stays silent (away from home, or no way to wake it). */
    suspend fun up(app: Context, tv: Tv): Boolean {
        fun answers() = runCatching { Pairing.hello(tv.host, tv.port, 1500); true }.getOrDefault(false)
        if (answers()) return true
        if (!tv.canWake()) return false
        val ble = if (tv.bt.isNotBlank()) BleWaker.start(app, tv.bt) else null
        if (ble != null) android.util.Log.i("TiviBroReach", "Bluetooth: ${ble.result}")
        try {
            val end = System.currentTimeMillis() + BleWake.ADVERTISE_MS
            while (System.currentTimeMillis() < end) {
                if (tv.wakeMacs().isNotEmpty()) runCatching { Wol.wakeAll(tv.wakeMacs(), tv.host) }
                delay(3000)
                if (answers()) { delay(4000); return true }     // the TV answers a little before TiviBro can be opened
            }
        } finally {
            ble?.stop()
        }
        return answers()
    }
}
