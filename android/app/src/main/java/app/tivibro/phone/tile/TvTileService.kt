/* The Quick Settings tile: one tap opens TiviBro on the chosen TV (waking it first when it is off). */
package app.tivibro.phone.tile

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.Pairing
import app.tivibro.phone.proto.TvClient
import app.tivibro.phone.proto.Wol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Quick Settings tile: TiviBro on the TV.  One tap turns the TV on if it is off (Wake-on-LAN) and opens
 * TiviBro.  For the TV picked in the app (or the only one).
 *
 * The work runs in a scope that outlives the tile: Android lets go of the tile service as soon as the
 * Quick Settings panel closes, and work tied to it was cancelled before the TV was asked (the tile
 * did nothing).  The tile is only redrawn while Android still has it.
 */
private object TileWork { val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO) }

class TvTileService : TileService() {

    override fun onStartListening() {
        val tv = TvStore(this).tileChoice()
        qsTile?.apply {
            label = "TiviBro"
            sub(this, tv?.name ?: "Pair a TV in the app")
            state = if (tv == null) Tile.STATE_UNAVAILABLE else Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onClick() {
        val tv = TvStore(this).tileChoice() ?: return
        qsTile?.apply { state = Tile.STATE_ACTIVE; sub(this, "Opening…"); updateTile() }
        val app = applicationContext
        TileWork.scope.launch {
            android.util.Log.i("TiviBroTile", "Opening TiviBro on ${tv.name}")
            val ok = run {
                fun up() = runCatching { Pairing.hello(tv.host, tv.port, 1500); true }.getOrDefault(false)
                if (!up() && tv.mac.isNotBlank()) {
                    val end = System.currentTimeMillis() + 45_000
                    while (System.currentTimeMillis() < end) {
                        runCatching { Wol.wake(tv.mac, tv.host) }
                        delay(3000)
                        if (up()) break
                    }
                    delay(4000)       // the TV answers before TiviBro can be opened
                }
                runCatching { TvClient(tv).open() }.onFailure { android.util.Log.w("TiviBroTile", "Open failed: ${it.message}") }.isSuccess
            }
            android.util.Log.i("TiviBroTile", if (ok) "Opened" else "${tv.name} didn't answer")
            withContext(Dispatchers.Main) {
                if (!ok) Toast.makeText(app, "${tv.name} didn't answer", Toast.LENGTH_SHORT).show()
                runCatching { qsTile?.apply { state = Tile.STATE_INACTIVE; sub(this, tv.name); updateTile() } }
            }
        }
    }
}

// The line under the tile's name exists from Android 10.
private fun sub(t: Tile, s: String) { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) t.subtitle = s }
