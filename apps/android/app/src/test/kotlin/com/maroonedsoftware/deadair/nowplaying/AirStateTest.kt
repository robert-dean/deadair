package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Telling warming up from off air.
 *
 * The station answers `onAir: false` for both, so the answer alone cannot separate them. What does
 * is whether this listener is currently asking for audio — which matters because under
 * `playout.airMode: audience` the asking is what puts the station on air in the first place.
 */
class AirStateTest {
    private val track = NowPlayingTrack(title = "Windowlicker", artist = "Aphex Twin", startedAt = 1)

    private fun answered(onAir: Boolean, track: NowPlayingTrack? = null) =
        NowPlayingState.Answered(Reading(NowPlaying(station = "S", onAir = onAir, listeners = 0, mounts = emptyList(), track = track), 0))

    @Test
    fun `names the record when one is playing`() {
        assertEquals(AirState.OnAir(track), airState(answered(onAir = true, track = track), playbackRequested = true))
    }

    @Test
    fun `is off air when the station is quiet and nobody asked for audio`() {
        assertEquals(AirState.OffAir, airState(answered(onAir = false), playbackRequested = false))
    }

    @Test
    fun `is warming up when audio was asked for and nothing is through yet`() {
        // The seconds after pressing play on an audience-gated station: the lease is taken, the
        // first record is fetched, the encoder starts. Ordinary, and not an error.
        assertEquals(AirState.WarmingUp, airState(answered(onAir = false), playbackRequested = true))
    }

    @Test
    fun `is warming up before the first answer arrives, not off air`() {
        assertEquals(AirState.WarmingUp, airState(NowPlayingState.Loading, playbackRequested = true))
    }

    @Test
    fun `does not claim a record for an on-air answer that names none`() {
        // A shape the contract says will not occur. Believing it would mean showing a record that
        // is not there, so it degrades to the honest state instead.
        assertEquals(AirState.WarmingUp, airState(answered(onAir = true, track = null), playbackRequested = true))
    }

    @Test
    fun `says the station is unreachable however good the last reading was`() {
        val state = NowPlayingState.Unreachable(Reading(NowPlaying("S", true, 3, emptyList(), track), 0))

        assertTrue(airState(state, playbackRequested = true) is AirState.Unreachable)
    }
}
