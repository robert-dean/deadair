package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.ui.history.airedLabel
import com.maroonedsoftware.deadair.ui.text.AiredLabel
import com.maroonedsoftware.deadair.ui.text.Clock
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * When a record aired, as a listener reads it.
 *
 * The opposite case from the schedule's stamps, and the difference is the point: `airedAt` is a real
 * instant, so it is shown in the listener's own zone. A phone in another country should read the
 * time as it was where its owner was standing, not where the transmitter is.
 */
class HistoryClockTest {
    private val london = ZoneId.of("Europe/London")

    private fun at(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        ZonedDateTime.of(year, month, day, hour, minute, 0, 0, london).toInstant().toEpochMilli()

    private val now = at(2026, 9, 6, 21, 30)

    @Test
    fun `today is just the clock`() {
        assertEquals(AiredLabel.Today(Clock(21, 14)), airedLabel(at(2026, 9, 6, 21, 14), now, london))
        assertEquals(AiredLabel.Today(Clock(8, 5)), airedLabel(at(2026, 9, 6, 8, 5), now, london))
    }

    @Test
    fun `yesterday says so`() {
        assertEquals(AiredLabel.Yesterday(Clock(23, 50)), airedLabel(at(2026, 9, 5, 23, 50), now, london))
    }

    @Test
    fun `inside the week a weekday still identifies the day`() {
        // 2 September 2026 is a Wednesday.
        assertEquals(AiredLabel.Weekday(DayOfWeek.WEDNESDAY, Clock(14, 0)), airedLabel(at(2026, 9, 2, 14, 0), now, london))
    }

    @Test
    fun `past a week a weekday stops identifying anything`() {
        assertEquals(AiredLabel.OnDate(LocalDate.of(2026, 8, 28)), airedLabel(at(2026, 8, 28, 14, 0), now, london))
    }

    @Test
    fun `reads the instant in the zone it is shown in`() {
        // The same moment, read from two places. The station's own clock is not involved: this is
        // a point in time, unlike a schedule block's ends.
        val moment = at(2026, 9, 6, 21, 14)

        assertEquals(AiredLabel.Today(Clock(21, 14)), airedLabel(moment, now, london))
        assertEquals(AiredLabel.Today(Clock(22, 14)), airedLabel(moment, now, ZoneId.of("Europe/Paris")))
    }
}
