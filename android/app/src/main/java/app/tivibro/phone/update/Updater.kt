/* Updates the phone app in place: downloads the release APK into the app's own cache (proto/AppUpdate.kt
   checks its size and fingerprint), makes sure it is this app and newer, and hands it to Android's
   PackageInstaller.  Android sends the outcome to UpdateReceiver: asking the user to confirm (the screen it
   carries is opened), installed, or failed (its message is shown).  The release APK is signed with the same
   key every time, so it installs over the old one; test builds (app.tivibro.phone.debug) can't, and keep the
   browser link.  Everything here outlives the home screen's card, which only shows [step]. */
package app.tivibro.phone.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.IntentCompat
import androidx.core.content.pm.PackageInfoCompat
import app.tivibro.phone.proto.AppRelease
import app.tivibro.phone.proto.AppUpdate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.util.concurrent.CancellationException

/** Where an update in place is. */
sealed interface UpdateStep {
    data object Idle : UpdateStep
    /** Android's "Install unknown apps" is off for TiviBro: Settings was opened, carry on when the user is back. */
    data object NeedsPermission : UpdateStep
    /** [total] is 0 when the size isn't known. */
    data class Downloading(val done: Long, val total: Long) : UpdateStep
    data object Installing : UpdateStep
    /** Android wants the user to confirm: [confirm] is its screen. */
    data class Confirm(val confirm: Intent) : UpdateStep
    data class Failed(val message: String) : UpdateStep
    data object Done : UpdateStep
}

object Updater {
    private const val TAG = "TiviBroUpdate"
    const val ACTION_STATUS = "app.tivibro.phone.UPDATE_STATUS"

    private val _step = MutableStateFlow<UpdateStep>(UpdateStep.Idle)
    val step: StateFlow<UpdateStep> = _step
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var job: Job? = null

    /** A test build has a different package name (.debug) and key: it can't update over the release app. */
    fun inPlace(ctx: Context): Boolean = !ctx.packageName.endsWith(".debug")

    private fun dir(ctx: Context) = File(ctx.cacheDir, "update")

    /** Removes downloaded APKs left over (after an install, or a download cut short), unless one is under way. */
    fun cleanup(ctx: Context) {
        if (job?.isActive == true) return
        runCatching { dir(ctx).deleteRecursively() }
    }

    /** "Install unknown apps" for TiviBro (minSdk is 26, so this is always Android 8 or later). */
    fun allowed(ctx: Context): Boolean = runCatching { ctx.packageManager.canRequestPackageInstalls() }.getOrDefault(false)

    fun reset() { if (job?.isActive != true) _step.value = UpdateStep.Idle }
    fun fail(message: String) { if (job?.isActive != true) _step.value = UpdateStep.Failed(message) }

    /** "Update now": opens Settings first when installing apps isn't allowed (the card calls this again
     *  when the user comes back), otherwise downloads and installs.  [ctx] is the activity. */
    fun start(ctx: Context, r: AppRelease) {
        if (job?.isActive == true) return
        if (!allowed(ctx)) {
            _step.value = UpdateStep.NeedsPermission
            val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.packageName))
            runCatching { ctx.startActivity(i) }.onFailure {
                _step.value = UpdateStep.Failed("This phone has no setting to let TiviBro install apps.")
            }
            return
        }
        val app = ctx.applicationContext
        _step.value = UpdateStep.Downloading(0, r.size)
        // Started once [job] is set, so a download cancelled and started again can't report over the new one.
        val j = scope.launch(start = CoroutineStart.LAZY) {
            val me = coroutineContext[Job]
            fun say(s: UpdateStep) { if (job === me) _step.value = s }
            val file = File(dir(app), "tivibro-update-${System.currentTimeMillis()}.apk")
            try {
                AppUpdate.download(r, file, keepGoing = { isActive }) { done, total -> say(UpdateStep.Downloading(done, total)) }
                checkPackage(app, file)
                say(UpdateStep.Installing)
                install(app, file)
            } catch (e: CancellationException) {
                say(UpdateStep.Idle)
            } catch (e: Exception) {
                Log.w(TAG, "update failed", e)
                say(UpdateStep.Failed(e.message ?: "The update didn't download."))
            } finally {
                // Once written into Android's install session the file isn't needed any more.
                runCatching { file.delete() }
            }
        }
        job = j
        j.start()
    }

    fun cancel() {
        job?.cancel()
        _step.value = UpdateStep.Idle
    }

    /** The download must be this app, and newer than what's installed. */
    private fun checkPackage(ctx: Context, f: File) {
        val pm = ctx.packageManager
        @Suppress("DEPRECATION")
        val info = pm.getPackageArchiveInfo(f.path, 0) ?: throw IOException("The download isn't an Android app.")
        if (info.packageName != ctx.packageName) throw IOException("The download is a different app.")
        @Suppress("DEPRECATION")
        val mine = pm.getPackageInfo(ctx.packageName, 0)
        if (PackageInfoCompat.getLongVersionCode(info) <= PackageInfoCompat.getLongVersionCode(mine)) throw IOException("The download isn't newer than this app.")
    }

    /** Streams [f] into a PackageInstaller session and commits it; the outcome comes to UpdateReceiver. */
    private fun install(ctx: Context, f: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        params.setSize(f.length())
        // Android 12+: no question when TiviBro installed itself last time (Android still asks the first time).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { s ->
                f.inputStream().use { inp ->
                    s.openWrite("tivibro.apk", 0, f.length()).use { out ->
                        inp.copyTo(out, 64 * 1024)
                        s.fsync(out)
                    }
                }
                val back = Intent(ctx, UpdateReceiver::class.java).setAction(ACTION_STATUS).setPackage(ctx.packageName)
                // PackageInstaller fills in the status extras, so the PendingIntent must be mutable on Android 12+.
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                val pi = PendingIntent.getBroadcast(ctx, id, back, flags)
                s.commit(pi.intentSender)
            }
        } catch (e: Exception) {
            runCatching { installer.abandonSession(id) }
            throw IOException("Android couldn't start the install.", e)
        }
    }

    /** What UpdateReceiver heard from PackageInstaller. */
    internal fun status(ctx: Context, status: Int, message: String?, confirm: Intent?) {
        Log.i(TAG, "install status $status: $message")
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                if (confirm == null) { _step.value = UpdateStep.Failed("Android didn't show its install question."); return }
                _step.value = UpdateStep.Confirm(confirm)
                // Opened straight away while TiviBro is on screen; otherwise the card's Continue opens it.
                runCatching { ctx.startActivity(Intent(confirm).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            }
            PackageInstaller.STATUS_SUCCESS -> { _step.value = UpdateStep.Done; cleanup(ctx) }
            else -> _step.value = UpdateStep.Failed(failure(status, message))
        }
    }

    private fun failure(status: Int, message: String?): String {
        val plain = when (status) {
            PackageInstaller.STATUS_FAILURE_ABORTED -> "The update was cancelled."
            PackageInstaller.STATUS_FAILURE_BLOCKED -> "Android blocked the update."
            PackageInstaller.STATUS_FAILURE_CONFLICT -> "The update clashes with the app on this phone."
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "This phone can't run the new version."
            PackageInstaller.STATUS_FAILURE_INVALID -> "The download isn't a valid app."
            PackageInstaller.STATUS_FAILURE_STORAGE -> "There isn't enough space on the phone."
            else -> "The update didn't install."
        }
        return if (message.isNullOrBlank()) plain else "$plain  Android says: $message"
    }
}

/** Receives PackageInstaller's outcome for a commit (not exported: only the PendingIntent above reaches it). */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Updater.ACTION_STATUS) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
        Updater.status(ctx, status, message, confirm)
    }
}
