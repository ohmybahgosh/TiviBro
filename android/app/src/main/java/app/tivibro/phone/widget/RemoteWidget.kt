/* The Remote widget: TiviBro's remote on the phone's home screen, for the TV picked in the app (or the only one).
   The arrows round OK, Back, play and pause, Info, volume and mute (the TV's own), channel up and down and the colour
   buttons each send one press, as the app's Remote does (TiviBro is opened on the TV when a key needs it).  Power
   turns the TV on and opens TiviBro when the TV doesn't answer, and turns it off when it does. */
package app.tivibro.phone.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.Toast
import app.tivibro.phone.I18n
import app.tivibro.phone.R
import app.tivibro.phone.data.TvStore
import app.tivibro.phone.proto.Pairing
import app.tivibro.phone.proto.TvClient
import app.tivibro.phone.tr
import app.tivibro.phone.work.TvReach
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class RemoteWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, wm: AppWidgetManager, ids: IntArray) = ids.forEach { draw(ctx, wm, it) }

    override fun onReceive(ctx: Context, i: Intent) {
        super.onReceive(ctx, i)
        if (i.action == PRESS) press(ctx.applicationContext, i.getStringExtra("b").orEmpty())
    }

    // One button: a key, the TV's volume, or power.  In TvReach's scope (a receiver is let go of within seconds), one at a time.
    private fun press(app: Context, b: String) {
        I18n.ensure(app)
        val tv = TvStore(app).tileChoice()
        if (tv == null) { Toast.makeText(app, tr("Pair a TV in the app"), Toast.LENGTH_LONG).show(); return }
        TvReach.scope.launch {
            val msg = runCatching {
                when (b) {
                    "volup" -> { TvClient(tv, 4000).volume("up"); null }
                    "voldown" -> { TvClient(tv, 4000).volume("down"); null }
                    "mute" -> { TvClient(tv, 4000).volume("mute"); null }
                    "power" -> power(app, tv)
                    else -> { TvClient(tv, 4000).key(b); null }
                }
            }.getOrElse { tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name) }
            if (msg != null) withContext(Dispatchers.Main) { Toast.makeText(app, msg, Toast.LENGTH_SHORT).show() }
        }
    }

    // Power: off when the TV answers; otherwise on (Wake-on-LAN, Bluetooth when allowed) and TiviBro opened.
    private suspend fun power(app: Context, tv: app.tivibro.phone.proto.Tv): String {
        val on = runCatching { Pairing.hello(tv.host, tv.port, 1500); true }.getOrDefault(false)
        if (on) { TvClient(tv, 5000).powerOff(); return tr("Turning {x} off", "x" to tv.name) }
        withContext(Dispatchers.Main) { Toast.makeText(app, tr("Turning on {x}…", "x" to tv.name), Toast.LENGTH_SHORT).show() }
        return if (TvReach.up(app, tv) && runCatching { TvClient(tv).open() }.isSuccess) tr("Opened") else tr("{x} didn't answer.  Is the phone on the same network?", "x" to tv.name)
    }

    companion object {
        const val PRESS = "app.tivibro.phone.REMOTE_PRESS"
        /** Each button, and what it sends ("power", "volup", "voldown", "mute", or a key TiviBro's phone API takes). */
        private val BUTTONS = listOf(
            R.id.rw_power to "power", R.id.rw_mute to "mute", R.id.rw_up to "up", R.id.rw_down to "down", R.id.rw_left to "left", R.id.rw_right to "right",
            R.id.rw_ok to "ok", R.id.rw_back to "back", R.id.rw_play to "playpause", R.id.rw_info to "info", R.id.rw_volup to "volup", R.id.rw_voldown to "voldown",
            R.id.rw_chup to "chup", R.id.rw_chdown to "chdown", R.id.rw_red to "red", R.id.rw_green to "green", R.id.rw_yellow to "yellow", R.id.rw_blue to "blue")
        /** What a screen reader says for each button. */
        private fun label(b: String) = when (b) {
            "power" -> tr("Turn on or off"); "mute" -> tr("Mute"); "up" -> tr("Up"); "down" -> tr("Down"); "left" -> tr("Left"); "right" -> tr("Right")
            "ok" -> "OK"; "back" -> tr("Back"); "playpause" -> tr("Play or pause"); "info" -> tr("Info"); "volup" -> tr("Volume up"); "voldown" -> tr("Volume down")
            "chup" -> tr("Channel up"); "chdown" -> tr("Channel down"); "red" -> tr("Red"); "green" -> tr("Green"); "yellow" -> tr("Yellow"); else -> tr("Blue")
        }

        /** Every Remote widget drawn again (the TV picked in the app changed). */
        fun drawAll(ctx: Context) {
            val wm = AppWidgetManager.getInstance(ctx)
            wm.getAppWidgetIds(ComponentName(ctx, RemoteWidget::class.java)).forEach { draw(ctx, wm, it) }
        }

        private fun draw(ctx: Context, wm: AppWidgetManager, id: Int) {
            I18n.ensure(ctx)
            val v = RemoteViews(ctx.packageName, R.layout.widget_remote)
            v.setTextViewText(R.id.rw_name, TvStore(ctx).tileChoice()?.name ?: tr("Pair a TV in the app"))
            BUTTONS.forEachIndexed { n, (view, b) ->
                v.setOnClickPendingIntent(view, PendingIntent.getBroadcast(ctx, 100 + n, Intent(ctx, RemoteWidget::class.java).setAction(PRESS).putExtra("b", b),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
                v.setContentDescription(view, label(b))
            }
            wm.updateAppWidget(id, v)
        }
    }
}
