/* Reminders on the phone: the TV's reminders (set on the TV, from the guide here, by the watchlist or My teams) also
   come up as a notification on this phone a minute before they start, wherever the phone is.  The list is kept in
   step whenever the app sees it (the Reminders screen) and about every 15 minutes in the background
   (ReminderSyncWorker; the TV's helper answers even with TiviBro closed).  Watch on TV in the notification turns the
   TV on when it can and plays the programme there, with the other channels showing it to fall back on.  Off with
   the switch at the top of the Reminders screen. */
package app.tivibro.phone.notify

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tivibro.phone.MainActivity
import app.tivibro.phone.R
import app.tivibro.phone.proto.Reminder
import app.tivibro.phone.proto.Tv
import app.tivibro.phone.tr
import org.json.JSONArray
import org.json.JSONObject

/** One reminder as this phone keeps it: which TV it came from, the channel, the programme and its times. */
data class PhoneReminder(val tv: String, val tvName: String, val k: String, val channel: String, val title: String, val start: Long, val end: Long) {
    /** The alarm's and notification's number: the same reminder always gets the same one, so it is replaced, not doubled. */
    val code: Int get() = "$tv|$k|$start".hashCode()

    fun json(): JSONObject = JSONObject().put("tv", tv).put("tvName", tvName).put("k", k).put("ch", channel).put("t", title).put("s", start).put("e", end)

    companion object {
        fun from(j: JSONObject) = PhoneReminder(j.optString("tv"), j.optString("tvName"), j.optString("k"), j.optString("ch"), j.optString("t"), j.optLong("s"), j.optLong("e"))
    }
}

object PhoneReminders {
    /** How long before the start the notification comes. */
    const val LEAD_MS = 60_000L
    private const val CHANNEL = "reminders"
    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences("phone-reminders", Context.MODE_PRIVATE)

    /** The switch on the Reminders screen (on unless turned off). */
    fun on(ctx: Context) = prefs(ctx).getBoolean("on", true)
    fun setOn(ctx: Context, v: Boolean) { prefs(ctx).edit().putBoolean("on", v).apply(); reschedule(ctx) }

    /** May the app show notifications?  Android 13 and later ask once (MainActivity); before that it's on unless turned off in Android's settings. */
    fun allowed(ctx: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    /** Asked for the permission already (it is asked once; after that Android's own settings decide). */
    fun asked(ctx: Context) = prefs(ctx).getBoolean("asked", false)
    fun markAsked(ctx: Context) { prefs(ctx).edit().putBoolean("asked", true).apply() }

    fun all(ctx: Context): List<PhoneReminder> = runCatching {
        val a = JSONArray(prefs(ctx).getString("list", "[]"))
        (0 until a.length()).map { PhoneReminder.from(a.getJSONObject(it)) }
    }.getOrDefault(emptyList())

    private fun save(ctx: Context, l: List<PhoneReminder>) { prefs(ctx).edit().putString("list", JSONArray().apply { l.forEach { put(it.json()) } }.toString()).apply() }

    /** [tv]'s reminders as it just gave them: replaces what this phone had from it, then sets the alarms again. */
    fun update(ctx: Context, tv: Tv, list: List<Reminder>) {
        val now = System.currentTimeMillis()
        val mine = list.filter { it.end > now }.map { PhoneReminder(tv.id, tv.name, it.k, it.channel, it.title, it.start, it.end) }
        save(ctx, merge(all(ctx), tv.id, mine, now))
        reschedule(ctx)
    }

    /** Pure: [old] with [tv]'s entries swapped for [fresh], ended ones dropped, soonest first.  Tests call it. */
    fun merge(old: List<PhoneReminder>, tv: String, fresh: List<PhoneReminder>, now: Long): List<PhoneReminder> =
        (old.filter { it.tv != tv && it.end > now } + fresh).distinctBy { it.code }.sortedBy { it.start }

    /** When the notification for [r] comes: a minute early, or at once for one that has started (a reminder set late). */
    fun fireAt(r: PhoneReminder, now: Long): Long = maxOf(r.start - LEAD_MS, now + 1000)

    /** Sets an alarm for every reminder still to come, and cancels those that went (or all of them, switched off).
     *  Inexact by a few minutes at most when the phone dozes (no exact-alarm permission is asked for). */
    fun reschedule(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java) ?: return
        val now = System.currentTimeMillis()
        val keep = if (on(ctx)) all(ctx).filter { it.start + 5 * 60_000 > now } else emptyList()
        val before = prefs(ctx).getString("codes", "").orEmpty().split(',').mapNotNull { it.toIntOrNull() }.toSet()
        (before - keep.map { it.code }.toSet()).forEach { am.cancel(fire(ctx, null, it)) }
        keep.forEach { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt(it, now), fire(ctx, it, it.code)) }
        prefs(ctx).edit().putString("codes", keep.joinToString(",") { it.code.toString() }).apply()
    }

    private fun fire(ctx: Context, r: PhoneReminder?, code: Int): PendingIntent {
        val i = Intent(ctx, ReminderReceiver::class.java).setAction(ReminderReceiver.FIRE)
        if (r != null) i.putExtra("r", r.json().toString())
        return PendingIntent.getBroadcast(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** The notification itself: the programme, its channel and TV, with Watch on TV.  Tapping it opens the app. */
    fun show(ctx: Context, r: PhoneReminder) {
        if (!on(ctx) || !allowed(ctx)) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(NotificationChannel(CHANNEL, tr("Reminders"), NotificationManager.IMPORTANCE_HIGH).apply { description = tr("A reminder set on the TV, a minute before it starts") })
        val open = PendingIntent.getActivity(ctx, r.code, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
        val watch = PendingIntent.getBroadcast(ctx, r.code, Intent(ctx, ReminderReceiver::class.java).setAction(ReminderReceiver.WATCH).putExtra("r", r.json().toString()),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val starts = if (r.start <= System.currentTimeMillis()) tr("On now on {x}", "x" to r.channel) else tr("Starts at {x} on {y}", "x" to hhmm(ctx, r.start), "y" to r.channel)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_tile)
            .setContentTitle(r.title)
            .setContentText("$starts  ·  ${r.tvName}")
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .setAutoCancel(true)
            .setTimeoutAfter(maxOf(60_000L, r.end - System.currentTimeMillis()))
            .addAction(0, tr("Watch on TV"), watch)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(r.code, n) }
    }

    fun dismiss(ctx: Context, r: PhoneReminder) = NotificationManagerCompat.from(ctx).cancel(r.code)

    private fun hhmm(ctx: Context, t: Long): String = android.text.format.DateFormat.getTimeFormat(ctx).format(java.util.Date(t))
}
