package com.maroonedsoftware.deadair.playback

import org.junit.Assert.assertEquals
import org.junit.Test

/** The default network as the playback journal writes it: changes only, and the right losses. */
class NetworkNotesTest {
    private val lines = mutableListOf<String>()
    private val notes = NetworkNotes { lines += it }

    @Test
    fun `writes the kind of network and whether Android validated it`() {
        notes.onDefault(WIFI, "wifi", validated = true)

        assertEquals(listOf("network wifi handle=$WIFI validated=yes"), lines)
    }

    @Test
    fun `capabilities reported again unchanged write nothing`() {
        // Signal strength rides along with capabilities, so they are reported far more often than
        // anything written here changes.
        repeat(5) { notes.onDefault(WIFI, "wifi", validated = true) }

        assertEquals(1, lines.size)
    }

    @Test
    fun `a wifi losing its validation is written, which is what a fading wifi looks like`() {
        notes.onDefault(WIFI, "wifi", validated = true)
        notes.onDefault(WIFI, "wifi", validated = false)

        assertEquals("network wifi handle=$WIFI validated=no", lines.last())
    }

    @Test
    fun `a flip between wifi and cellular is a line each way`() {
        notes.onDefault(WIFI, "wifi", validated = true)
        notes.onDefault(CELL, "cellular", validated = true)
        notes.onDefault(WIFI, "wifi", validated = true)

        assertEquals(
            listOf(
                "network wifi handle=$WIFI validated=yes",
                "network cellular handle=$CELL validated=yes",
                "network wifi handle=$WIFI validated=yes",
            ),
            lines,
        )
    }

    @Test
    fun `the old network's late loss after a handover is not written as going offline`() {
        notes.onDefault(WIFI, "wifi", validated = true)
        notes.onDefault(CELL, "cellular", validated = true)

        notes.onLost(WIFI)

        assertEquals(2, lines.size)
    }

    @Test
    fun `losing the default is written, and the same network coming back is written again`() {
        notes.onDefault(WIFI, "wifi", validated = true)
        notes.onLost(WIFI)
        notes.onDefault(WIFI, "wifi", validated = true)

        assertEquals(
            listOf(
                "network wifi handle=$WIFI validated=yes",
                "network none (handle=$WIFI lost)",
                "network wifi handle=$WIFI validated=yes",
            ),
            lines,
        )
    }

    private companion object {
        const val WIFI = 100L
        const val CELL = 200L
    }
}
