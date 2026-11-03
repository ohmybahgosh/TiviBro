package app.tivibro.phone

import app.tivibro.phone.proto.AppUpdate
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Is a newer phone app out (issue #33)? */
class AppUpdateTest {
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
}
