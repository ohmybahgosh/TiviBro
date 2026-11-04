/* The Bluetooth log of the last Turn on (or Listen for the TV): what the phone sent and what it heard from the
   TV, second by second, so a wake that didn't show up can be looked into.  Only the last one is kept, on the
   phone; the TV card's menu shows it, with Share.  It holds no secrets: the TV's name, the phone's model and
   what the TV advertises to anyone nearby. */
package app.tivibro.phone.ble

import android.content.Context
import android.os.Build
import app.tivibro.phone.proto.TvAdvert
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Date
import java.util.Locale

class WakeLog(tvName: String) {
    private val t0 = System.currentTimeMillis()
    private val lines = Collections.synchronizedList(mutableListOf<String>())
    private var lastHex: String? = null
    private var lastAt = -1L
    private var heard = 0

    init {
        lines += "TiviBro Bluetooth log: $tvName, " + SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(t0)) +
            ", ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
    }

    /** Milliseconds since the log started. */
    fun ms(): Long = System.currentTimeMillis() - t0

    fun add(s: String) { lines += line(ms(), s) }

    /** One advertisement from the TV: written when it differs from the last one, or every 5 seconds with a count. */
    @Synchronized
    fun advert(atMs: Long, rssi: Int, hex: String, ad: TvAdvert?) {
        heard++
        if (hex == lastHex && atMs - lastAt < 5000) return
        val what = if (hex.isEmpty()) "no LG data" else hex + (ad?.let { "  ($it${if (it.wakeOff) ", wake-up off" else ""})" } ?: "")
        lines += line(atMs, "TV advertises, signal $rssi dBm: $what  [$heard heard]")
        lastHex = hex; lastAt = atMs; heard = 0
    }

    fun text(): String = synchronized(lines) { lines.joinToString("\n") }

    fun save(ctx: Context) {
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, text()).apply()
    }

    private fun line(atMs: Long, s: String) = "%6.1fs  %s".format(Locale.US, atMs / 1000.0, s)

    companion object {
        private const val PREFS = "blewake"
        private const val KEY = "log"
        /** The last saved log, or "" when there is none. */
        fun last(ctx: Context): String = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "").orEmpty()
    }
}
