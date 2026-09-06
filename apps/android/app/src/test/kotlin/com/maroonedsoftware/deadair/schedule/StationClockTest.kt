package com.maroonedsoftware.deadair.schedule

import com.maroonedsoftware.deadair.ui.text.Clock
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.Span
import java.time.DayOfWeek
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Reading the station's clock, which is not this phone's.
 *
 * Every stamp the schedule sends is zone-naive on purpose: it is a READING of the station's clock
 * rather than a moment, so a show that starts at eight starts at eight wherever the listener is.
 * These tests are what stop somebody "fixing" that by attaching a timezone.
 */
class StationClockTest {
    @Test
    fun `measures the gap between two readings`() {
        assertEquals(45L, minutesBetween("2026-09-06 20:00:00", "2026-09-06 20:45:00"))
    }

    @Test
    fun `measures across midnight, which every night has`() {
        assertEquals(30L, minutesBetween("2026-09-06 23:45:00", "2026-09-07 00:15:00"))
    }

    @Test
    fun `measures backwards as a negative, so a block already over reads as ending`() {
        assertEquals(-15L, minutesBetween("2026-09-06 20:15:00", "2026-09-06 20:00:00"))
        assertEquals(Span.Ending, spanOf(minutesBetween("2026-09-06 20:15:00", "2026-09-06 20:00:00")))
    }

    @Test
    fun `takes no notice of a daylight saving change`() {
        // The answer is how much CLOCK is left, not how much time. On the night the clocks go back,
        // a block ending at two reads an hour shorter than it will run — which is the right answer
        // for a screen whose whole subject is what the station's clock says, and is the same
        // arithmetic the console's own strip does.
        assertEquals(120L, minutesBetween("2026-10-25 00:00:00", "2026-10-25 02:00:00"))
    }

    @Test
    fun `reads nothing out of something that is not a stamp`() {
        assertNull(readClock("tomorrow"))
        assertEquals(0L, minutesBetween("tomorrow", "2026-09-06 20:00:00"))
    }

    @Test
    fun `measures a length in the unit somebody would say it in`() {
        assertEquals(Span.Ending, spanOf(0))
        assertEquals(Span.Minutes(1), spanOf(1))
        assertEquals(Span.Minutes(59), spanOf(59))
        assertEquals(Span.Hours(1, 0), spanOf(60))
        assertEquals(Span.Hours(1, 30), spanOf(90))
        assertEquals(Span.Hours(23, 59), spanOf(1439))
        assertEquals(Span.ADay, spanOf(1440))
        assertEquals(Span.Days(6), spanOf(6 * 24 * 60))
    }

    @Test
    fun `gives a block its hours, and its weekday only when it is not today`() {
        val now = "2026-09-06 20:30:00"

        assertEquals(Message.BlockHours(Clock(20, 0), Clock(22, 0), day = null), hoursOf("2026-09-06 20:00:00", "2026-09-06 22:00:00", now))
        // 7 September 2026 is a Monday. Three of these sit stacked and the useful difference
        // between them is the hour, so the date is dropped and the day kept.
        assertEquals(
            Message.BlockHours(Clock(9, 0), Clock(11, 0), day = DayOfWeek.MONDAY),
            hoursOf("2026-09-07 09:00:00", "2026-09-07 11:00:00", now),
        )
    }

    @Test
    fun `gives no hours at all for a stamp it cannot read`() {
        assertNull(hoursOf("soon", "2026-09-06 22:00:00", "2026-09-06 20:30:00"))
    }
}
