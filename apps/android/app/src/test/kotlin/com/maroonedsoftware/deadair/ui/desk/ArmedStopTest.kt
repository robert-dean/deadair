package com.maroonedsoftware.deadair.ui.desk

import com.maroonedsoftware.deadair.ui.nowplaying.ArmedStop
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Take off air is two presses, and a forgotten first press is forgotten rather than kept. */
class ArmedStopTest {
    @Test
    fun `the first press arms and fires nothing`() {
        var fired = 0
        val stop = ArmedStop { fired++ }

        stop.press()

        assertTrue(stop.armed)
        assertEquals(0, fired)
    }

    @Test
    fun `the second press fires once and disarms`() {
        var fired = 0
        val stop = ArmedStop { fired++ }

        stop.press()
        stop.press()

        assertFalse(stop.armed)
        assertEquals(1, fired)
    }

    @Test
    fun `a lapsed arm needs two presses again`() {
        var fired = 0
        val stop = ArmedStop { fired++ }

        stop.press()
        stop.disarm()
        stop.press()

        assertTrue(stop.armed)
        assertEquals(0, fired)
    }
}
