package com.maroonedsoftware.deadair.schedule

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
        assertEquals("ending", formatSpan(minutesBetween("2026-09-06 20:15:00", "2026-09-06 20:00:00")))
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
    fun `says a length the way somebody would say it`() {
        assertEquals("ending", formatSpan(0))
        assertEquals("1 min", formatSpan(1))
        assertEquals("59 min", formatSpan(59))
        assertEquals("1 h", formatSpan(60))
        assertEquals("1 h 30 min", formatSpan(90))
        assertEquals("23 h 59 min", formatSpan(1439))
        assertEquals("a day", formatSpan(1440))
        assertEquals("6 days", formatSpan(6 * 24 * 60))
    }

    @Test
    fun `gives a block its hours, and its weekday only when it is not today`() {
        val now = "2026-09-06 20:30:00"

        assertEquals("20:00–22:00", formatHours("2026-09-06 20:00:00", "2026-09-06 22:00:00", now))
        // 7 September 2026 is a Monday. Three of these sit stacked and the useful difference
        // between them is the hour, so the date is dropped and the day kept.
        assertEquals("Mon 09:00–11:00", formatHours("2026-09-07 09:00:00", "2026-09-07 11:00:00", now))
    }

    @Test
    fun `gives no hours at all for a stamp it cannot read`() {
        assertEquals("", formatHours("soon", "2026-09-06 22:00:00", "2026-09-06 20:30:00"))
    }
}
