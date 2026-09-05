package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The projected playhead.
 *
 * The rule worth defending is the one about NOT projecting: a clock extrapolated from a start time
 * would keep moving confidently while being wrong, and the transport is not allowed to be a
 * moving, confident lie.
 */
class PlayheadTest {
    private fun track(durationMs: Long? = 300_000, remainingMs: Long? = 120_000, startedAt: Long = 1_700_000_000_000) =
        NowPlayingTrack(title = "t", artist = "a", durationMs = durationMs, startedAt = startedAt, remainingMs = remainingMs)

    @Test
    fun `has nothing to show without a track`() {
        assertNull(project(null, readAtMs = 0, nowMs = 0))
    }

    @Test
    fun `has nothing to show when the decoder could not say how long the record is`() {
        assertNull(project(track(durationMs = null), readAtMs = 0, nowMs = 1_000))
    }

    @Test
    fun `refuses to extrapolate from the start time alone`() {
        // `startedAt` is present and `remainingMs` is not. Everything needed for a plausible clock
        // is here, and the answer is still nothing — which is the whole point.
        assertNull(project(track(remainingMs = null), readAtMs = 0, nowMs = 1_000))
    }

    @Test
    fun `carries the clock forward between readings`() {
        val head = project(track(), readAtMs = 1_000, nowMs = 3_500)!!

        // 2.5s past the reading, so 117.5s left of a 300s record.
        assertEquals(117_500, head.remainingMs)
        assertEquals(182_500, head.elapsedMs)
        assertEquals(300_000, head.durationMs)
    }

    @Test
    fun `re-anchors on a fresh reading rather than drifting`() {
        val carried = project(track(remainingMs = 100_000), readAtMs = 0, nowMs = 9_000)!!
        // The station's next answer says something different. It wins outright.
        val anchored = project(track(remainingMs = 120_000), readAtMs = 9_000, nowMs = 9_000)!!

        assertEquals(91_000, carried.remainingMs)
        assertEquals(120_000, anchored.remainingMs)
    }

    @Test
    fun `stops at the end of the record rather than running past it`() {
        // The next reading is late — a slow poll, a backed-off one — and a clock that ran negative
        // would show a progress bar past its own end.
        val head = project(track(remainingMs = 2_000), readAtMs = 0, nowMs = 60_000)!!

        assertEquals(0, head.remainingMs)
        assertEquals(300_000, head.elapsedMs)
        assertEquals(1f, head.fraction, 0.0001f)
    }

    @Test
    fun `never reports more left than the record is long`() {
        // A clock that went backwards — which a device clock change would do, were this measured
        // against one rather than against elapsed time.
        val head = project(track(remainingMs = 400_000), readAtMs = 5_000, nowMs = 0)!!

        assertEquals(300_000, head.remainingMs)
        assertEquals(0, head.elapsedMs)
    }

    @Test
    fun `has nothing to show for a record of no length`() {
        assertNull(project(track(durationMs = 0), readAtMs = 0, nowMs = 0))
    }
}
