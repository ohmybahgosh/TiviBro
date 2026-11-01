/* Backup files the web editor can read: a TiviBro backup encrypted with a passphrase the user picks,
   in the same format as the editor's Download a backup (service/editor.js): AES-256-GCM with a key from
   PBKDF2-SHA256, 200,000 rounds.  The phone saves a copy this way so it can be restored on any TV, with
   or without the app. */
package app.tivibro.phone.proto

import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

object BackupFile {
    private const val ITER = 200_000

    private fun key(pass: String, salt: ByteArray, iter: Int): ByteArray =
        SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(pass.toCharArray(), salt, iter, 256)).encoded

    /** The backup as the TV made it, sealed with [pass] for a file. */
    fun seal(backup: JSONObject, pass: String, iter: Int = ITER): JSONObject {
        val rnd = SecureRandom()
        val salt = ByteArray(16).also { rnd.nextBytes(it) }
        val iv = ByteArray(12).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key(pass, salt, iter), "AES"), GCMParameterSpec(128, iv))
        val out = c.doFinal(backup.toString().toByteArray(Charsets.UTF_8))
        return JSONObject()
            .put("app", "TiviBro").put("kind", "backup-encrypted").put("format", 2)
            .put("version", backup.optString("version")).put("created", backup.optString("created"))
            .put("playlists", backup.optJSONObject("settings")?.optJSONArray("playlists")?.length() ?: 0)
            .put("kdf", "pbkdf2-sha256").put("iter", iter).put("cipher", "aes-256-gcm")
            .put("salt", b64(salt)).put("iv", b64(iv)).put("tag", b64(out.copyOfRange(out.size - 16, out.size))).put("data", b64(out.copyOfRange(0, out.size - 16)))
    }

    /** Opens a sealed backup file.  Throws on a wrong passphrase or a changed file. */
    fun open(file: JSONObject, pass: String): JSONObject {
        if (file.optString("kind") == "backup") return file
        val iter = file.optInt("iter", ITER)
        if (file.optString("kdf") != "pbkdf2-sha256" || file.optString("cipher") != "aes-256-gcm" || iter < 10_000 || iter > 5_000_000) throw TbException("This backup uses a format this version can't read.")
        return runCatching {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key(pass, unb64(file.getString("salt")), iter), "AES"), GCMParameterSpec(128, unb64(file.getString("iv"))))
            JSONObject(String(c.doFinal(unb64(file.getString("data")) + unb64(file.getString("tag"))), Charsets.UTF_8))
        }.getOrElse { throw TbException("Wrong passphrase, or the file was changed.") }
    }

    /** A plain or sealed TiviBro backup? */
    fun isBackup(j: JSONObject?) = j != null && j.optString("app") == "TiviBro" && (j.optString("kind") == "backup" || j.optString("kind") == "backup-encrypted")
}
