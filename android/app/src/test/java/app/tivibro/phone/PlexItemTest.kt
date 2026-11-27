/* The phone's Plex tab reads the TV's answers (plexphone.js slim()): what plays by itself, where it stopped. */
package app.tivibro.phone

import app.tivibro.phone.ui.PlexItem
import app.tivibro.phone.ui.PlexRow
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

    // Rows as the TV draws them (plexphone.js row()): wide or posters, people, a category still to read.
    @Test fun rowsFromTheTv() {
        val a = JSONArray()
            .put(JSONObject().put("title", "Continue watching").put("wide", true).put("kind", "wide")
                .put("items", JSONArray().put(JSONObject().put("server", "s1").put("key", "7").put("type", "episode").put("title", "The Harbor Lights").put("wide", "/library/metadata/7/thumb/1"))))
            .put(JSONObject().put("title", "Cast and crew").put("kind", "person")
                .put("people", JSONArray().put(JSONObject().put("tag", "Ada Lane").put("role", "Captain").put("id", "55").put("field", "actor").put("sec", "1"))))
            .put(JSONObject().put("title", "Comedy").put("genre", "Comedy"))
        val r = PlexRow.list(a)
        assertTrue(r[0].wide); assertEquals("/library/metadata/7/thumb/1", r[0].items[0].wide); assertTrue(r[0].items[0].hasPage)
        assertEquals("person", r[1].kind); assertEquals("Ada Lane", r[1].people[0].tag); assertEquals("actor", r[1].people[0].field)
        assertEquals("Comedy", r[2].genre); assertTrue(r[2].items.isEmpty())
        val clip = PlexItem.list(JSONArray().put(JSONObject().put("type", "clip")))[0]
        assertFalse("a trailer plays on the TV, it has no page", clip.hasPage)
    }
}
