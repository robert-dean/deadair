package com.maroonedsoftware.deadair.ui.text

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * A time of day, written the way the phone writes them.
 *
 * Twelve-hour or twenty-four-hour is the phone's setting and not the station's, and for an audience
 * in the United States every time in the app read wrong until it was honoured.
 */
class ClockLabelTest {
    @Test
    fun `writes the twenty-four-hour form with a leading zero`() {
        assertEquals("21:14", clockLabel(Clock(21, 14), uses24Hour = true, locale = Locale.UK))
        assertEquals("08:05", clockLabel(Clock(8, 5), uses24Hour = true, locale = Locale.GERMANY))
    }

    @Test
    fun `writes the twelve-hour form the way a clock face reads`() {
        assertEquals("9:14 PM", clockLabel(Clock(21, 14), uses24Hour = false, locale = Locale.US))
        assertEquals("12:05 AM", clockLabel(Clock(0, 5), uses24Hour = false, locale = Locale.US))
        assertEquals("12:00 PM", clockLabel(Clock(12, 0), uses24Hour = false, locale = Locale.US))
    }
}
