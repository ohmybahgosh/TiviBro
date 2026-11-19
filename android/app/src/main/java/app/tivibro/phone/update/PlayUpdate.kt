/* Updates for the Google Play build (BuildConfig.SELF_UPDATE false): Play doesn't let an app install its own
   updates, and a closed test's updates often don't show in the Play Store on their own.  So the app asks Play
   whether it has a newer version for this phone (Play's in-app updates library), and when it does, or when Play
   can't say, takes you to TiviBro's Play Store listing to update there. */
package app.tivibro.phone.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

object PlayUpdate {
    /** true: Google Play has a newer version for this phone; false: this is the newest; null: Play couldn't say
        (not installed from Play, no Play services, no network). */
    suspend fun available(ctx: Context): Boolean? = withTimeoutOrNull(15_000) {
        suspendCancellableCoroutine { k ->
            try {
                AppUpdateManagerFactory.create(ctx.applicationContext).appUpdateInfo
                    .addOnSuccessListener { info ->
                        val a = info.updateAvailability()
                        if (k.isActive) k.resume(when (a) {
                            UpdateAvailability.UPDATE_AVAILABLE, UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS -> true
                            UpdateAvailability.UPDATE_NOT_AVAILABLE -> false
                            else -> null
                        })
                    }
                    .addOnFailureListener { if (k.isActive) k.resume(null) }
            } catch (e: Exception) { if (k.isActive) k.resume(null) }
        }
    }

    /** TiviBro's page in the Play Store app (the web page when there is no Play Store). */
    fun open(ctx: Context) {
        val id = ctx.packageName
        val store = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$id")).setPackage("com.android.vending").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { ctx.startActivity(store) }.onFailure {
            runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$id")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }
}
