package com.maroonedsoftware.deadair.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Time lost on a live stream, and the record change that gives it back. */
class LiveDriftTest {
    private val drift = LiveDrift(slackMs = 8_000)

    @Test
    fun `the start of a connection is not time lost`() {
        // Buffering before the first audio is the connection starting, not falling behind.
        drift.onPlaying(isPlaying = false, wantsPlay = true, atMs = 0)
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 3_000)

        assertEquals(0, drift.behindMs(10_000))
    }

    @Test
    fun `stalls add up`() {
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 0)
        drift.onPlaying(isPlaying = false, wantsPlay = true, atMs = 1_000)
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 4_000)
        drift.onPlaying(isPlaying = false, wantsPlay = true, atMs = 10_000)

        // Three seconds ended, two still going.
        assertEquals(5_000, drift.behindMs(12_000))
    }

    @Test
    fun `a record change past the slack jumps and forgets`() {
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 0)
        drift.onPlaying(isPlaying = false, wantsPlay = true, atMs = 1_000)
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 10_000)

        assertEquals(9_000L, drift.onRecordHeard(isRecord = true, atMs = 60_000))
        assertEquals(0, drift.behindMs(60_000))
    }

    @Test
    fun `under the slack plays on`() {
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 0)
        drift.onPlaying(isPlaying = false, wantsPlay = true, atMs = 1_000)
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 5_000)

        assertNull(drift.onRecordHeard(isRecord = true, atMs = 60_000))
        assertEquals(4_000, drift.behindMs(60_000))
    }

    @Test
    fun `a break is never cut into, and the next record still catches up`() {
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 0)
        drift.onPlaying(isPlaying = false, wantsPlay = true, atMs = 1_000)
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 21_000)

        assertNull(drift.onRecordHeard(isRecord = false, atMs = 30_000))
        assertEquals(20_000L, drift.onRecordHeard(isRecord = true, atMs = 90_000))
    }

    @Test
    fun `not playing because the listener stopped is not lost`() {
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 0)
        drift.onPlaying(isPlaying = false, wantsPlay = false, atMs = 1_000)

        assertEquals(0, drift.behindMs(30_000))
    }

    @Test
    fun `a reset starts the count again`() {
        drift.onPlaying(isPlaying = true, wantsPlay = true, atMs = 0)
        drift.onPlaying(isPlaying = false, wantsPlay = true, atMs = 1_000)
        drift.reset()

        assertEquals(0, drift.behindMs(30_000))
        // And the next silence before the fresh connection plays is its start, not a loss.
        drift.onPlaying(isPlaying = false, wantsPlay = true, atMs = 30_000)
        assertEquals(0, drift.behindMs(40_000))
    }
}
