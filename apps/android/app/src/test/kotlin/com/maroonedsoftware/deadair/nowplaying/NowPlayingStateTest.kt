package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * Which reading a screen draws.
 *
 * The rule is that while this phone is playing, the record and its playhead are the ones the
 * listener is hearing, and whether the station is answering is still the poll's to say.
 */
class NowPlayingStateTest {
    private fun reading(title: String, readAtMs: Long) =
        Reading(
            NowPlaying(
                station = "Test FM",
                onAir = true,
                listeners = 1,
                mounts = emptyList(),
                track = NowPlayingTrack(title = title, artist = "Someone", startedAt = 1_000),
            ),
            readAtMs,
        )

    private val polled = reading("Next", readAtMs = 3_000)
    private val aired = reading("Still Playing", readAtMs = 8_000)

    @Test
    fun `playing, the screen draws what the listener is hearing`() {
        assertEquals(NowPlayingState.Answered(aired), NowPlayingState.Answered(polled).heard(aired, playing = true))
    }

    @Test
    fun `an unreachable station is still unreachable over the record that is playing`() {
        assertEquals(NowPlayingState.Unreachable(aired), NowPlayingState.Unreachable(polled).heard(aired, playing = true))
    }

    @Test
    fun `stopped, the poll is the only word there is`() {
        val state = NowPlayingState.Answered(polled)
        assertSame(state, state.heard(aired, playing = false))
    }

    @Test
    fun `playing with nothing released yet draws the poll`() {
        val state = NowPlayingState.Answered(polled)
        assertSame(state, state.heard(null, playing = true))
    }

    @Test
    fun `a poll starting over is not answered by a release from before it`() {
        assertSame(NowPlayingState.Loading, NowPlayingState.Loading.heard(aired, playing = true))
    }
}
