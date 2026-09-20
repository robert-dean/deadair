package com.maroonedsoftware.deadair.widget

import com.maroonedsoftware.deadair.ui.nowplaying.STOP_ARMED_MS
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ArmedSkipTest {
    private var now = 0L
    private val skip = ArmedSkip(now = { now })

    @Test
    fun `the first press arms and cuts nothing`() {
        assertEquals(SkipPress.ARMED, skip.press())
        assertTrue(skip.armed())
    }

    @Test
    fun `the second press inside the window fires`() {
        skip.press()
        now += STOP_ARMED_MS - 1
        assertEquals(SkipPress.FIRE, skip.press())
        assertFalse(skip.armed())
    }

    @Test
    fun `a press after the window arms again rather than firing`() {
        skip.press()
        now += STOP_ARMED_MS
        assertFalse(skip.armed())
        assertEquals(SkipPress.ARMED, skip.press())
    }

    @Test
    fun `firing disarms, so a third press has to arm again`() {
        skip.press()
        assertEquals(SkipPress.FIRE, skip.press())
        assertEquals(SkipPress.ARMED, skip.press())
    }

    @Test
    fun `it can be disarmed by something other than a press`() {
        skip.press()
        skip.disarm()
        assertFalse(skip.armed())
        assertEquals(SkipPress.ARMED, skip.press())
    }

    @Test
    fun `skip is offered to the operator, and only over something that is on`() {
        val record = WidgetReading.Record("A Forest", "The Cure")

        assertTrue(offersSkip(operator = true, reading = record))
        assertTrue(offersSkip(operator = true, reading = WidgetReading.Break(host = "Cass", label = "Ident")))
        assertFalse(offersSkip(operator = false, reading = record))
        // Resting, the widget has not asked the station anything, so it does not know whether
        // there is a record to cut.
        assertFalse(offersSkip(operator = true, reading = WidgetReading.Resting))
        assertFalse(offersSkip(operator = true, reading = WidgetReading.WarmingUp))
        assertFalse(offersSkip(operator = true, reading = WidgetReading.Unreachable))
        assertFalse(offersSkip(operator = true, reading = WidgetReading.NoStation))
    }
}
