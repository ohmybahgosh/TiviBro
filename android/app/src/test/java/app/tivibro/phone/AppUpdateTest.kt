package app.tivibro.phone

import app.tivibro.phone.proto.AppRelease
import app.tivibro.phone.proto.AppUpdate
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

/** Is a newer phone app out (issue #33)?  And is the downloaded APK the one GitHub described? */
class AppUpdateTest {
    @get:Rule val tmp = TemporaryFolder()

    private val helloSha = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

    @Test fun versions() {
        assertTrue(AppUpdate.newer("0.6.0-alpha.65", "0.6.0-alpha.64"))
        assertTrue(AppUpdate.newer("0.6.0-alpha.100", "0.6.0-alpha.99"))
        assertTrue(AppUpdate.newer("0.6.0-beta.1", "0.6.0-alpha.99"))
        assertTrue(AppUpdate.newer("0.6.0", "0.6.0-beta.3"))
        assertFalse(AppUpdate.newer("0.6.0-alpha.64", "0.6.0-alpha.64"))
        assertFalse(AppUpdate.newer("0.6.0-alpha.63", "0.6.0-alpha.64"))
    }
    @Test fun picksTheNewestWithAnApk() {
        val list = JSONArray("""[
          {"tag_name":"v0.6.0-alpha.66","draft":true,"assets":[{"name":"tivibro-phone-0.6.0-alpha.66.apk","browser_download_url":"u66"}]},
          {"tag_name":"v0.6.0-alpha.65","assets":[{"name":"app.ipk","browser_download_url":"x"}]},
          {"tag_name":"v0.6.0-alpha.64","html_url":"p64","assets":[{"name":"tivibro-phone-0.6.0-alpha.64-debug.apk","browser_download_url":"d"},{"name":"tivibro-phone-0.6.0-alpha.64.apk","browser_download_url":"u64"}]},
          {"tag_name":"v0.6.0-alpha.63","assets":[{"name":"tivibro-phone-0.6.0-alpha.63.apk","browser_download_url":"u63"}]}]""")
        val r = AppUpdate.pick(list)!!
        assertEquals("0.6.0-alpha.64", r.version); assertEquals("u64", r.apk); assertEquals("p64", r.page)
    }
    @Test fun testBuildsNeverAsk() { assertNull(AppUpdate.check("0.1.0-dev")) }
    @Test fun picksSizeAndDigest() {
        val list = JSONArray("""[
          {"tag_name":"v0.6.0-alpha.75","html_url":"p75","assets":[{"name":"tivibro-phone-0.6.0-alpha.75.apk","browser_download_url":"u75","size":18234567,"digest":"sha256:${helloSha.uppercase()}"}]},
          {"tag_name":"v0.6.0-alpha.74","assets":[{"name":"tivibro-phone-0.6.0-alpha.74.apk","browser_download_url":"u74","size":100}]}]""")
        val r = AppUpdate.pick(list)!!
        assertEquals("0.6.0-alpha.75", r.version); assertEquals("u75", r.apk); assertEquals("p75", r.page)
        assertEquals(18234567L, r.size); assertEquals(helloSha, r.sha256)
    }
    @Test fun digestIsOptional() {
        // No digest, a null one, or one that isn't SHA-256: no fingerprint, the size still counts.
        val list = JSONArray("""[
          {"tag_name":"v0.6.0-alpha.70","assets":[{"name":"a.apk","browser_download_url":"u70","size":5}]},
          {"tag_name":"v0.6.0-alpha.71","assets":[{"name":"a.apk","browser_download_url":"u71","size":6,"digest":null}]},
          {"tag_name":"v0.6.0-alpha.72","assets":[{"name":"a.apk","browser_download_url":"u72","digest":"md5:abc"}]}]""")
        val r = AppUpdate.pick(list)!!
        assertEquals("0.6.0-alpha.72", r.version); assertNull(r.sha256); assertEquals(0L, r.size)
        assertNull(AppUpdate.pick(JSONArray("""[{"tag_name":"v0.6.0-alpha.71","assets":[{"name":"a.apk","size":6,"digest":null}]}]"""))!!.sha256)
        assertNull(AppUpdate.digest(null))
        assertNull(AppUpdate.digest("sha256:1234"))
        assertNull(AppUpdate.digest("sha256:" + "z".repeat(64)))
        assertEquals(helloSha, AppUpdate.digest(" sha256:$helloSha "))
    }
    @Test fun hashCheck() {
        val f = tmp.newFile("a.apk").apply { writeText("hello") }
        assertEquals(helloSha, AppUpdate.sha256(f))
        val r = AppRelease("1.0.0", "u", "p")
        assertNull(AppUpdate.problem(f, r))
        assertNull(AppUpdate.problem(f, r.copy(size = 5, sha256 = helloSha)))
        assertNotNull(AppUpdate.problem(f, r.copy(size = 6)))
        assertNotNull(AppUpdate.problem(f, r.copy(size = 5, sha256 = "0".repeat(64))))
        assertNotNull(AppUpdate.problem(tmp.newFile("empty.apk"), r))
        assertNotNull(AppUpdate.problem(File(tmp.root, "missing.apk"), r))
    }
    @Test fun refusesPlainHttp() {
        val dest = File(tmp.root, "update/a.apk")
        val e = runCatching { AppUpdate.download(AppRelease("1.0.0", "http://example.com/a.apk", "p"), dest, { true }) { _, _ -> } }.exceptionOrNull()
        assertTrue(e is IOException)
        assertFalse(dest.exists()); assertFalse(File(dest.path + ".part").exists())
    }
}
