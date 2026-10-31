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
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Quick Settings tile: TiviBro on the TV.  One tap turns the TV on if it is off (Wake-on-LAN) and opens
 * TiviBro.  For the TV picked in the app (or the only one).
 */
class TvTileService : TileService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

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
        scope.launch {
            val ok = withContext(Dispatchers.IO) {
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
                runCatching { TvClient(tv).open() }.isSuccess
            }
            if (!ok) Toast.makeText(this@TvTileService, "${tv.name} didn't answer", Toast.LENGTH_SHORT).show()
            qsTile?.apply { state = Tile.STATE_INACTIVE; sub(this, tv.name); updateTile() }
        }
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

// The line under the tile's name exists from Android 10.
private fun sub(t: Tile, s: String) { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) t.subtitle = s }
