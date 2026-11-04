/* Turning the TV on over Bluetooth (Wake on BLE), as LG's ThinQ app does.  The phone keeps a made-up
   Bluetooth address of its own (made once per install), registered with each TV while it is on
   (POST /v1/blewake, service/blewake.js).  To wake a TV that is off, the phone advertises LG's wake packet
   (proto/BleWake.kt: the phone's address and the TV's) for up to a minute, next to Wake-on-LAN.
   Android 12 and later need the "Nearby devices" permission (BLUETOOTH_ADVERTISE), asked the first time
   Turn on is used; without it, or with Bluetooth off, only Wake-on-LAN runs. */
package app.tivibro.phone.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import app.tivibro.phone.proto.BleWake

object BleWaker {
    private const val TAG = "TiviBroBle"
    private const val PREFS = "blewake"

    enum class Start { STARTED, OFF, NOT_ALLOWED, UNSUPPORTED, BAD_ADDRESS, FAILED }

    /** One advertisement: [stop] ends it (also safe when it never started). */
    class Advert internal constructor(val result: Start, private val stopper: (() -> Unit)? = null) {
        fun stop() { runCatching { stopper?.invoke() } }
    }

    /** This phone's made-up wake address, made the first time and kept for this install. */
    @Synchronized
    fun address(ctx: Context): String {
        val p = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        p.getString("address", null)?.takeIf { BleWake.isAddress(it) }?.let { return it }
        val a = BleWake.newAddress()
        p.edit().putString("address", a).commit()
        return a
    }

    /** May the app advertise?  Android 12 and later: the Nearby devices permission.  Before: granted at install. */
    fun allowed(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED

    /** Ask for the permission now?  Only once, the first time Turn on is used with a TV that has Bluetooth. */
    fun shouldAsk(ctx: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !allowed(ctx) && hasBle(ctx) &&
            !ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("asked", false)

    fun markAsked(ctx: Context) { ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("asked", true).apply() }

    private fun hasBle(ctx: Context) = ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)

    /**
     * Starts advertising the wake packet for the TV whose Bluetooth address is [tvBt].  It stops by itself
     * after [BleWake.ADVERTISE_MS] (a safety net); call [Advert.stop] as soon as the TV answers.
     */
    @SuppressLint("MissingPermission")
    fun start(ctx: Context, tvBt: String): Advert {
        val data = BleWake.manufacturerData(address(ctx), tvBt.lowercase()) ?: return Advert(Start.BAD_ADDRESS)
        if (!hasBle(ctx)) return Advert(Start.UNSUPPORTED)
        if (!allowed(ctx)) return Advert(Start.NOT_ALLOWED)
        val adapter = ctx.getSystemService(BluetoothManager::class.java)?.adapter ?: return Advert(Start.UNSUPPORTED)
        val on = try { adapter.isEnabled } catch (e: SecurityException) { return Advert(Start.NOT_ALLOWED) }
        if (!on) return Advert(Start.OFF)
        // Null when the phone can't advertise (some older or cheaper Bluetooth chips).
        val adv: BluetoothLeAdvertiser = (try { adapter.bluetoothLeAdvertiser } catch (e: SecurityException) { return Advert(Start.NOT_ALLOWED) })
            ?: return Advert(Start.UNSUPPORTED)
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(BleWake.ADVERTISE_MS.toInt())
            .build()
        // Flags, LG's manufacturer data (18 bytes) and the 16-bit service UUID: 25 of the 31 bytes.  No device
        // name (ThinQ adds it in the scan response; it would need another permission and the TV doesn't need it).
        val ad = AdvertiseData.Builder()
            .addManufacturerData(BleWake.LG_COMPANY_ID, data)
            .addServiceUuid(ParcelUuid(BleWake.SERVICE_UUID))
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build()
        val cb = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) { Log.i(TAG, "Advertising the wake packet") }
            override fun onStartFailure(errorCode: Int) { Log.w(TAG, "Advertising failed: $errorCode") }
        }
        return try {
            adv.startAdvertising(settings, ad, cb)
            Advert(Start.STARTED) {
                try { if (allowed(ctx)) adv.stopAdvertising(cb) } catch (e: SecurityException) { } catch (e: IllegalStateException) { }
                Log.i(TAG, "Stopped advertising")
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Not allowed to advertise: ${e.message}"); Advert(Start.NOT_ALLOWED)
        } catch (e: Exception) {
            Log.w(TAG, "Could not advertise: ${e.message}"); Advert(Start.FAILED)
        }
    }
}
