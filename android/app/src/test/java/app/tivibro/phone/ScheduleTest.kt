package app.tivibro.phone

import app.tivibro.phone.proto.Programme
import app.tivibro.phone.proto.Schedule
import org.junit.Assert.assertEquals
import org.junit.Test

/** A channel's schedule never lists two programmes at one start: that crashed the app (CNN, election night). */
class ScheduleTest {
    @Test fun emptyAndRepeatedStartsAreLeftOut() {
        val h = 3_600_000L
        val progs = listOf(
            Programme("Election Night in America", 6 * h, 7 * h),
            Programme("CNN Special Program", 8 * h, 9 * h),
            Programme("CNN Special Program", 9 * h, 9 * h),          // no time of its own
            Programme("Election Day In America", 9 * h, 10 * h),
            Programme("Election Day In America", 9 * h, 10 * h),     // the same start twice
            Programme("Backwards", 11 * h, 10 * h),
        )
        val out = Schedule.clean(progs)
        assertEquals(listOf(6 * h, 8 * h, 9 * h), out.map { it.start })
        assertEquals("Election Day In America", out.last().title)
    }
}
