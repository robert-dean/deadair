package com.maroonedsoftware.deadair.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** How long the player waits before trying a failed stream again. */
class BackoffTest {
    @Test
    fun `doubles from a second up to a ceiling`() {
        val backoff = Backoff()

        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), List(7) { backoff.next() })
    }

    @Test
    fun `gives up rather than retrying for the rest of the day`() {
        // A listener who walked away from a stopped stream should not come back to a flat battery.
        val backoff = Backoff()
        var waits = 0
        while (backoff.next() != null) waits += 1

        assertNull(backoff.next())
    }

    @Test
    fun `starts from a second again once the stream has played`() {
        val backoff = Backoff()
        repeat(4) { backoff.next() }

        backoff.reset()

        assertEquals(1_000L, backoff.next())
    }
}
