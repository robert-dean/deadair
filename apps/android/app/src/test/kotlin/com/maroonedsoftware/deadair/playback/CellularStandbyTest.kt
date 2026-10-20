package com.maroonedsoftware.deadair.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Whether a validated cellular network is standing by, and what the journal hears of it. */
class CellularStandbyTest {
    private val lines = mutableListOf<String>()
    private val cellular = CellularStandby { lines += it }

    @Test
    fun `a validated cellular network stands by, and is written once`() {
        repeat(3) { cellular.onCapabilities(LTE, isValidated = true) }

        assertEquals(LTE, cellular.standby)
        assertEquals(listOf("cellular standing by handle=$LTE"), lines)
    }

    @Test
    fun `one not yet validated does not stand by until it is`() {
        cellular.onCapabilities(LTE, isValidated = false)
        assertNull(cellular.standby)
        assertEquals(emptyList<String>(), lines)

        cellular.onCapabilities(LTE, isValidated = true)
        assertEquals(LTE, cellular.standby)
    }

    @Test
    fun `losing it, or its validation, is written`() {
        cellular.onCapabilities(LTE, isValidated = true)
        cellular.onCapabilities(LTE, isValidated = false)
        assertNull(cellular.standby)

        cellular.onCapabilities(LTE, isValidated = true)
        cellular.onLost(LTE)

        assertEquals(
            listOf(
                "cellular standing by handle=$LTE",
                "cellular none standing by",
                "cellular standing by handle=$LTE",
                "cellular none standing by",
            ),
            lines,
        )
    }

    @Test
    fun `keeps the one standing by while it lasts, and hands over to another when it goes`() {
        cellular.onCapabilities(LTE, isValidated = true)
        cellular.onCapabilities(NR, isValidated = true)
        assertEquals(LTE, cellular.standby)

        cellular.onLost(LTE)

        assertEquals(NR, cellular.standby)
        assertEquals("cellular standing by handle=$NR", lines.last())
    }

    @Test
    fun `losing a network that never stood by writes nothing`() {
        cellular.onCapabilities(LTE, isValidated = false)
        cellular.onLost(LTE)

        assertEquals(emptyList<String>(), lines)
    }

    private companion object {
        const val LTE = 574_636_347_405L
        const val NR = 437_197_393_933L
    }
}
