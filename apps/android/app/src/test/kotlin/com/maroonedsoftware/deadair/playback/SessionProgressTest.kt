package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.nowplaying.Playhead
import com.maroonedsoftware.deadair.nowplaying.Reading
import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the lock screen's bar is told.
 *
 * The rules worth pinning: it follows the reading the listener is HEARING (stamped for their ears,
 * so it can be ahead of now), it is a record's and never a break's, and a new record is announced
 * rather than left for the session to discover a few seconds late.
 */
class SessionProgressTest {
    private fun reading(
        kind: NowPlayingTrackKind? = NowPlayingTrackKind.RECORD,
        durationMs: Long? = 240_000,
        remainingMs: Long? = 60_000,
        readAtMs: Long = 10_000,
    ) =
        Reading(
            NowPlaying(
                station = "deadair",
                onAir = true,
                listeners = 1,
                mounts = emptyList(),
                track =
                    NowPlayingTrack(
                        title = "t",
                        artist = "a",
                        kind = kind,
                        durationMs = durationMs,
                        startedAt = 1_700_000_000_000,
                        remainingMs = remainingMs,
                    ),
            ),
            readAtMs,
        )

    @Test
    fun `a record with a length has a bar, projected from the heard reading`() {
        val playhead = sessionPlayhead(reading(), nowMs = 15_000)
        assertEquals(Playhead(elapsedMs = 185_000, remainingMs = 55_000, durationMs = 240_000), playhead)
    }

    @Test
    fun `a reading stamped for the ears ahead of now leaves more of the record to come, not less`() {
        // Released by the gate with readAtMs a buffer after the poll took it: until the ears get
        // there, the listener has more left than the station reported.
        val playhead = sessionPlayhead(reading(readAtMs = 20_000), nowMs = 12_000)
        assertEquals(172_000L, playhead?.elapsedMs)
    }

    @Test
    fun `a station older than the kind field reports a record`() {
        assertEquals(240_000L, sessionPlayhead(reading(kind = null), nowMs = 10_000)?.durationMs)
    }

    @Test
    fun `a break has no bar, even with a length`() {
        assertNull(sessionPlayhead(reading(kind = NowPlayingTrackKind.BREAK), nowMs = 10_000))
    }

    @Test
    fun `a programme with no length, or no countdown, has no bar`() {
        assertNull(sessionPlayhead(reading(durationMs = null), nowMs = 10_000))
        assertNull(sessionPlayhead(reading(remainingMs = null), nowMs = 10_000))
    }

    @Test
    fun `nothing heard, which is stopped or before the first release, has no bar`() {
        assertNull(sessionPlayhead(null, nowMs = 10_000))
        val offAir = Reading(NowPlaying(station = "deadair", onAir = false, listeners = 0, mounts = emptyList()), 10_000)
        assertNull(sessionPlayhead(offAir, nowMs = 10_000))
    }

    @Test
    fun `a poll re-anchoring the same record is left to the session's own extrapolation`() {
        val before = Playhead(elapsedMs = 100_000, remainingMs = 140_000, durationMs = 240_000)
        assertFalse(progressJumped(before, before.copy(elapsedMs = 100_400)))
        assertFalse(progressJumped(before, before.copy(elapsedMs = 99_200)))
        assertFalse(progressJumped(null, null))
    }

    @Test
    fun `a new record, a bar appearing or going, or a real jump is announced`() {
        val before = Playhead(elapsedMs = 238_000, remainingMs = 2_000, durationMs = 240_000)
        val next = Playhead(elapsedMs = 1_000, remainingMs = 199_000, durationMs = 200_000)
        assertTrue(progressJumped(before, next))
        assertTrue(progressJumped(before, null))
        assertTrue(progressJumped(null, next))
        assertTrue(progressJumped(before, before.copy(elapsedMs = 230_000)))
        // The same length twice running is still a different record when the position says so.
        assertTrue(progressJumped(before, before.copy(elapsedMs = 2_000)))
    }
}
