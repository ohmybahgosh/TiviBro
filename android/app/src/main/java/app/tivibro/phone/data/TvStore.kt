package app.tivibro.phone.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import app.tivibro.phone.proto.Tv
import app.tivibro.phone.proto.b64
import app.tivibro.phone.proto.unb64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Paired TVs, with their keys.  Kept encrypted under a key in the Android Keystore (it never leaves the
 * phone's secure hardware), in app storage that is left out of backups and device transfers.
 */
class TvStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("tvs", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        return g.generateKey()
    }

    @Synchronized
    fun load(): List<Tv> {
        val blob = prefs.getString("data", null) ?: return emptyList()
        return runCatching {
            val j = JSONObject(blob)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, unb64(j.getString("iv"))))
            val arr = JSONArray(String(c.doFinal(unb64(j.getString("data"))), Charsets.UTF_8))
            (0 until arr.length()).map { Tv.fromJson(arr.getJSONObject(it)) }
        }.getOrDefault(emptyList())
    }

    @Synchronized
    fun save(tvs: List<Tv>) {
        val arr = JSONArray()
        tvs.forEach { arr.put(it.toJson()) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val data = c.doFinal(arr.toString().toByteArray(Charsets.UTF_8))
        prefs.edit().putString("data", JSONObject().put("iv", b64(c.iv)).put("data", b64(data)).toString()).apply()
    }

    fun upsert(tv: Tv) {
        val l = load().filterNot { it.id == tv.id }.toMutableList()
        l += tv
        save(l)
    }

    fun remove(id: String) = save(load().filterNot { it.id == id })

    var tileTv: String?
        get() = prefs.getString("tile", null)
        set(v) { prefs.edit().putString("tile", v).apply() }

    /** The TV for the Quick Settings tile: the one picked, or the only one. */
    fun tileChoice(): Tv? {
        val l = load()
        return l.firstOrNull { it.id == tileTv } ?: l.singleOrNull()
    }

    companion object { private const val ALIAS = "tivibro-tvs" }
}
