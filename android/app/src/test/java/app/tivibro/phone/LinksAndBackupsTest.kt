package app.tivibro.phone

import app.tivibro.phone.proto.BackupFile
import app.tivibro.phone.proto.Crypto
import app.tivibro.phone.proto.ProviderLink
import app.tivibro.phone.proto.TbException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Shared provider links (read like app/js/links.js on the TV), sealed bodies, and backup files the web editor can read. */
class LinksAndBackupsTest {
    @Test fun providerLinks() {
        val x = ProviderLink.parse("http://line.example.com:8080/get.php?username=bob&password=s3cret&type=m3u_plus&output=ts")!!
        assertTrue(x.xtream); assertEquals("http://line.example.com:8080", x.server); assertEquals("bob", x.user); assertEquals("line.example.com:8080", x.host)
        val api = ProviderLink.parse("https://h.example/tv/player_api.php?username=a%40b&password=p")!!
        assertEquals("https://h.example/tv", api.server); assertEquals("a@b", api.user)
        val stream = ProviderLink.parse("http://h.example:80/live/u1/p+1/123.ts")!!
        assertTrue(stream.xtream); assertEquals("u1", stream.user); assertEquals("http://h.example:80", stream.server)
        val m3u = ProviderLink.parse("http://lists.example/my.m3u8")!!
        assertFalse(m3u.xtream); assertFalse(m3u.bare)
        assertTrue(ProviderLink.parse("http://only.example:8080")!!.bare)
        assertTrue(ProviderLink.parse("only.example:8080/get.php?username=a&password=b")!!.xtream)
        assertNull(ProviderLink.parse("two words"))
        val shared = ProviderLink.find("Thanks for your order!  Your link: http://p.example:25461/get.php?username=me&password=pw&type=m3u_plus.  Enjoy")!!
        assertEquals("me", shared.user); assertEquals("http://p.example:25461", shared.server)
    }

    @Test fun sealedBodiesOpenOnlyForTheirRequest() {
        val key = ByteArray(32) { it.toByte() }
        val box = Crypto.seal(JSONObject().put("pass", "secret"), key, "req", "abc123abc123", "nonce-one-nonce-one")
        assertFalse(box.toString().contains("secret"))
        assertEquals("secret", Crypto.unseal(box, key, "req", "abc123abc123", "nonce-one-nonce-one").getString("pass"))
        assertTrue(runCatching { Crypto.unseal(box, key, "req", "abc123abc123", "nonce-two-nonce-two") }.isFailure)
        assertTrue(runCatching { Crypto.unseal(box, key, "res", "abc123abc123", "nonce-one-nonce-one") }.isFailure)
    }

    @Test fun backupFilesMatchTheWebEditor() {
        // Made by the web editor's own code (service/editor.js) with the passphrase below.
        val fromEditor = JSONObject(javaClass.classLoader!!.getResource("editor-backup.json")!!.readText())
        val b = BackupFile.open(fromEditor, "correct horse battery")
        assertEquals("backup", b.getString("kind"))
        assertEquals("Home", b.getJSONObject("settings").getJSONArray("playlists").getJSONObject(0).getString("name"))
        val wrong = runCatching { BackupFile.open(fromEditor, "wrong") }.exceptionOrNull()
        assertTrue(wrong is TbException)

        val mine = BackupFile.seal(b, "another passphrase", iter = 20_000)
        assertEquals("backup-encrypted", mine.getString("kind"))
        assertEquals(1, mine.getInt("playlists"))
        assertFalse(mine.toString().contains("example.invalid"))
        assertEquals(b.toString(), BackupFile.open(mine, "another passphrase").toString())
    }
}
