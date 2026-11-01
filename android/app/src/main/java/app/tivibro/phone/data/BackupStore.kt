/* Backups of each TV's TiviBro, kept on the phone: made by hand or automatically once a week (while
   TiviBro is open on the TV, see work/BackupWorker.kt).  A backup holds every playlist login, so each one
   is encrypted with a key in the Android Keystore and kept in app storage that is left out of backups
   and device transfers.  The newest eight per TV are kept. */
package app.tivibro.phone.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.tivibro.phone.proto.b64
import app.tivibro.phone.proto.unb64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A backup on the phone: when it was made, from which TiviBro, and how many playlists it has. */
data class SavedBackup(val tvId: String, val file: File, val at: Long, val version: String, val playlists: Int, val auto: Boolean, val size: Long)

class BackupStore(context: Context) {
    private val root = File(context.applicationContext.filesDir, "backups")
    private val prefs = context.applicationContext.getSharedPreferences("backups", Context.MODE_PRIVATE)

    /** Automatic weekly backups (on unless switched off). */
    var auto: Boolean
        get() = prefs.getBoolean("auto", true)
        set(v) { prefs.edit().putBoolean("auto", v).apply() }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())
        return g.generateKey()
    }

    private fun dir(tvId: String) = File(root, tvId.filter { it.isLetterOrDigit() }).apply { mkdirs() }

    @Synchronized
    fun save(tvId: String, backup: JSONObject, auto: Boolean): SavedBackup {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val data = c.doFinal(backup.toString().toByteArray(Charsets.UTF_8))
        val at = System.currentTimeMillis()
        val meta = JSONObject().put("at", at).put("version", backup.optString("version")).put("auto", auto)
            .put("playlists", backup.optJSONObject("settings")?.optJSONArray("playlists")?.length() ?: 0)
        val f = File(dir(tvId), "$at.tbk")
        f.writeText(JSONObject().put("meta", meta).put("iv", b64(c.iv)).put("data", b64(data)).toString())
        prefs.edit().putLong("last:$tvId", at).apply()
        list(tvId).drop(KEEP).forEach { it.file.delete() }
        return read(tvId, f)!!
    }

    private fun read(tvId: String, f: File): SavedBackup? = runCatching {
        val m = JSONObject(f.readText()).getJSONObject("meta")
        SavedBackup(tvId, f, m.getLong("at"), m.optString("version"), m.optInt("playlists"), m.optBoolean("auto"), f.length())
    }.getOrNull()

    fun list(tvId: String): List<SavedBackup> = (dir(tvId).listFiles { f -> f.name.endsWith(".tbk") } ?: emptyArray()).mapNotNull { read(tvId, it) }.sortedByDescending { it.at }

    /** The backup itself, as the TV made it. */
    fun open(b: SavedBackup): JSONObject {
        val j = JSONObject(b.file.readText())
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, unb64(j.getString("iv"))))
        return JSONObject(String(c.doFinal(unb64(j.getString("data"))), Charsets.UTF_8))
    }

    fun delete(b: SavedBackup) { b.file.delete() }

    fun lastAt(tvId: String): Long = prefs.getLong("last:$tvId", 0)

    /** Is a weekly backup due for this TV? */
    fun due(tvId: String) = auto && System.currentTimeMillis() - lastAt(tvId) > WEEK

    /** A TV that was forgotten: its backups stay until removed here, in case it is paired again. */
    fun forget(tvId: String) { dir(tvId).deleteRecursively(); prefs.edit().remove("last:$tvId").apply() }

    companion object {
        private const val ALIAS = "tivibro-backups"
        const val KEEP = 8
        const val WEEK = 7L * 24 * 3600 * 1000
    }
}
