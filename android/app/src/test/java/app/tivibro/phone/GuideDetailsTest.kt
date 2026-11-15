package app.tivibro.phone

import app.tivibro.phone.proto.GuidePage
import app.tivibro.phone.proto.ProgDetail
import app.tivibro.phone.proto.Programme
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The guide's descriptions and marks, and one programme in full (ask "prog", app/js/phone.js). */
class GuideDetailsTest {
    @Test fun guideRowsCarryTheDescriptionAndMarks() {
        val j = JSONObject("""{"total":1,"offset":0,"pending":0,"rows":[{"k":"x1","a":1,"p":[
            {"t":"Grey's Anatomy","s":1000,"e":2000,"d":"Meredith has a hard day.","c":"d","nw":1,"ep":"S2 E5"},
            {"t":"News","s":2000,"e":3000}]}]}""")
        val p = GuidePage.from(j).rows[0].progs!!
        assertEquals("Meredith has a hard day.", p[0].desc)
        assertEquals("d", p[0].kind); assertTrue(p[0].isNew); assertEquals("S2 E5", p[0].ep)
        assertEquals("", p[1].desc); assertEquals("", p[1].kind); assertFalse(p[1].isNew)
    }

    @Test fun anOlderTvSendsNoneAndStillWorks() {
        val p = Programme.from(JSONObject("""{"t":"Movie","s":1,"e":2}"""))!!
        assertEquals("", p.kind); assertEquals("", p.ep); assertFalse(p.isNew)
    }

    @Test fun aProgrammeInFull() {
        val d = ProgDetail.from(JSONObject("""{"t":"Grey's Anatomy","s":1000,"e":2000,"d":"Full text","k":"x1","ch":"ABC","arch":3,"cu":1,"ep":"S2 E5",
            "tm":{"k":"s","poster":"p.jpg","backdrop":"b.jpg","plot":"A show.","year":"2005","genre":"Drama","rating":"8.2","network":"ABC","ep":{"t":"Enough Is Enough","plot":"An episode.","still":"s.jpg"}},
            "more":[{"k":"x2","ch":"ABC East","s":5000,"e":6000}]}"""))
        assertNotNull(d); d!!
        assertEquals("x1", d.key); assertEquals("ABC", d.channel); assertEquals(3, d.catchupDays); assertTrue(d.fromStart)
        assertTrue(d.tmdb!!.series); assertEquals("Enough Is Enough", d.tmdb!!.epTitle); assertEquals("s.jpg", d.tmdb!!.epStill)
        assertTrue(d.tmdb!!.facts.startsWith("Series"))
        assertEquals(1, d.more.size); assertEquals("ABC East", d.more[0].channel)
        assertFalse(d.descPending)
    }

    @Test fun noTitleNoDetails() {
        assertNull(ProgDetail.from(JSONObject("""{"s":1}""")))
    }
}
