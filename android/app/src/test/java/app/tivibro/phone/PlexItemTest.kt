/* The phone's Plex tab reads the TV's answers (plexphone.js slim()): what plays by itself, where it stopped. */
package app.tivibro.phone

import app.tivibro.phone.ui.PlexItem
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class PlexItemTest {
    @Test fun titlesFromTheTv() {
        val a = JSONArray()
            .put(JSONObject().put("server", "s1").put("key", "18").put("type", "movie").put("title", "Northbound").put("offset", 2400000).put("duration", 7200000))
            .put(JSONObject().put("server", "s1").put("key", "40").put("type", "show").put("title", "The Harbor Lights").put("left", 3))
        val l = PlexItem.list(a)
        assertEquals(2, l.size)
        assertTrue("a movie plays", l[0].plays); assertEquals(2400000L, l[0].offset)
        assertFalse("a show opens its seasons", l[1].plays); assertEquals(3, l[1].left)
        assertEquals(0, PlexItem.list(null).size)
    }
}
