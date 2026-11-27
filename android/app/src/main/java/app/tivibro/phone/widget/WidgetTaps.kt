/* Taps on the widgets' buttons (the Remote widget's keys, the Sports widget's games, refresh and links).  A receiver
   of its own that isn't exported: the widgets themselves must be (the launcher sends them their updates), so any
   app on the phone could send them a "press power" or "play this" of its own making.  Only the widgets'
   PendingIntents reach this one. */
package app.tivibro.phone.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class WidgetTaps : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        when (i.action) {
            RemoteWidget.PRESS -> RemoteWidget().press(ctx.applicationContext, i.getStringExtra("b").orEmpty())
            SportsWidget.PLAY, SportsWidget.REFRESH -> SportsWidget().tap(ctx, i)
        }
    }
}
