/* Watching for the TV over Bluetooth while the phone wakes it, as LG's ThinQ app does: an LG TV advertises
   itself (service 0000feb9, proto/BleWake.kt reads it), so the phone can tell it came on even when the phone
   isn't on Wi-Fi.  Android 12 and later only: scanning needs the Nearby devices permission
   (BLUETOOTH_SCAN, declared never used for location).  Older Android would need the location permission,
   so it doesn't scan and relies on Wi-Fi as before. */
package app.tivibro.phone.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import app.tivibro.phone.proto.BleWake

object BleWatcher {
    private const val TAG = "TiviBroBle"

    /** One scan: [stop] ends it (also safe when it never started). */
    class Watch internal constructor(val result: BleWaker.Start, private val stopper: (() -> Unit)? = null) {
        fun stop() { runCatching { stopper?.invoke() } }
    }

    /** May the app scan?  Android 12 and later with the Nearby devices permission. */
    fun allowed(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED

    /**
     * Starts listening for the TV whose Bluetooth address is [tvBt].  [onAdvert] gets each advertisement from it:
     * its signal strength and LG's manufacturer data (company 196), or null when it has none.  Called on the
     * main thread.  Call [Watch.stop] when done.
     */
    @SuppressLint("MissingPermission")
    fun start(ctx: Context, tvBt: String, onAdvert: (rssi: Int, data: ByteArray?) -> Unit): Watch {
        val want = tvBt.lowercase()
        if (!BleWake.isAddress(want)) return Watch(BleWaker.Start.BAD_ADDRESS)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return Watch(BleWaker.Start.UNSUPPORTED)
        if (!ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) return Watch(BleWaker.Start.UNSUPPORTED)
        if (!allowed(ctx)) return Watch(BleWaker.Start.NOT_ALLOWED)
        val adapter = ctx.getSystemService(BluetoothManager::class.java)?.adapter ?: return Watch(BleWaker.Start.UNSUPPORTED)
        val on = try { adapter.isEnabled } catch (e: SecurityException) { return Watch(BleWaker.Start.NOT_ALLOWED) }
        if (!on) return Watch(BleWaker.Start.OFF)
        val scanner: BluetoothLeScanner = (try { adapter.bluetoothLeScanner } catch (e: SecurityException) { return Watch(BleWaker.Start.NOT_ALLOWED) })
            ?: return Watch(BleWaker.Start.UNSUPPORTED)
        // Either filter lets an advertisement through: the TV's own address, or LG's TV service.
        val filters = mutableListOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(BleWake.TV_SERVICE_UUID)).build())
        if (BluetoothAdapter.checkBluetoothAddress(want.uppercase())) filters += ScanFilter.Builder().setDeviceAddress(want.uppercase()).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        val cb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                val r = result ?: return
                val rec = r.scanRecord
                val addr = runCatching { r.device?.address?.lowercase() }.getOrNull()
                if (addr != want && BleWake.addressFromRecord(rec?.bytes) != want) return
                onAdvert(r.rssi, rec?.getManufacturerSpecificData(BleWake.LG_COMPANY_ID))
            }
            override fun onBatchScanResults(results: MutableList<ScanResult>?) { results?.forEach { onScanResult(0, it) } }
            override fun onScanFailed(errorCode: Int) { Log.w(TAG, "Bluetooth scan failed: $errorCode") }
        }
        return try {
            scanner.startScan(filters, settings, cb)
            Watch(BleWaker.Start.STARTED) {
                try { if (allowed(ctx)) scanner.stopScan(cb) } catch (e: SecurityException) { } catch (e: IllegalStateException) { }
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Not allowed to scan: ${e.message}"); Watch(BleWaker.Start.NOT_ALLOWED)
        } catch (e: Exception) {
            Log.w(TAG, "Could not scan: ${e.message}"); Watch(BleWaker.Start.FAILED)
        }
    }
}
