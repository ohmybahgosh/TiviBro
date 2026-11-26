/* The Quick Settings tile: one tap opens TiviBro on the chosen TV (waking it first when it is off, with
   Wake-on-LAN and, when allowed, Bluetooth). */
package app.tivibro.phone.tile

import app.tivibro.phone.tr

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.Toast
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.TvClient
import app.tivibro.phone.work.TvReach
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Quick Settings tile: TiviBro on the TV.  One tap turns the TV on if it is off (Wake-on-LAN, and LG's
 * Bluetooth wake packet when the app may use Bluetooth: the tile never asks) and opens TiviBro.  For the TV
 * picked in the app (or the only one).
 *
 * The work runs in TvReach's scope, which outlives the tile (Android lets go of the tile service as soon as
 * the Quick Settings panel closes).  The tile is only redrawn while Android still has it.
 */

class TvTileService : TileService() {

    override fun onStartListening() {
        app.tivibro.phone.I18n.ensure(this)
        val tv = TvStore(this).tileChoice()
        qsTile?.apply {
            label = "TiviBro"
            sub(this, tv?.name ?: tr("Pair a TV in the app"))
            state = if (tv == null) Tile.STATE_UNAVAILABLE else Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onClick() {
        app.tivibro.phone.I18n.ensure(this)
        val tv = TvStore(this).tileChoice() ?: return
        qsTile?.apply { state = Tile.STATE_ACTIVE; sub(this, tr("Opening…")); updateTile() }
        val app = applicationContext
        TvReach.scope.launch {
            android.util.Log.i("TiviBroTile", "Opening TiviBro on ${tv.name}")
            val ok = TvReach.up(app, tv) && runCatching { TvClient(tv).open() }.onFailure { android.util.Log.w("TiviBroTile", "Open failed: ${it.message}") }.isSuccess
            android.util.Log.i("TiviBroTile", if (ok) tr("Opened") else "${tv.name} didn't answer")
            withContext(Dispatchers.Main) {
                if (!ok) Toast.makeText(app, "${tv.name} didn't answer", Toast.LENGTH_SHORT).show()
                runCatching { qsTile?.apply { state = Tile.STATE_INACTIVE; sub(this, tv.name); updateTile() } }
            }
        }
    }
}

// The line under the tile's name exists from Android 10.
private fun sub(t: Tile, s: String) { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) t.subtitle = s }
