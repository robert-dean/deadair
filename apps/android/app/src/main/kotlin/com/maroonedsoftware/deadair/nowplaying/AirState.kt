package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack

/** What to tell the listener the station is doing. */
sealed interface AirState {
    /** A record is playing and this is it. */
    data class OnAir(val track: NowPlayingTrack) : AirState

    /**
     * Connected, but nothing is coming through yet.
     *
     * Under `playout.airMode: audience` the station airs only while somebody is listening, so
     * CONNECTING is what puts it on air: the lease is taken, the first record is fetched, the
     * encoder starts. Those seconds are ordinary and this is what they are called. Showing them as
     * an error, or as a spinner that looks stuck, would make the station's normal behaviour read
     * as a fault.
     */
    data object WarmingUp : AirState

    /** Nothing is playing and nothing is being asked to. On an audience-gated station, the usual state. */
    data object OffAir : AirState

    /** The station is not answering. What is showing, if anything, is stale. */
    data object Unreachable : AirState
}

/**
 * What the station is doing, from its own answer and whether this app is asking for audio.
 *
 * Both halves are needed. `onAir` alone cannot tell warming up from off air, because they are the
 * same answer — `onAir: false` — and what separates them is whether this listener is currently
 * asking the station for anything.
 */
fun airState(state: NowPlayingState, playbackRequested: Boolean): AirState =
    when (state) {
        is NowPlayingState.Loading -> if (playbackRequested) AirState.WarmingUp else AirState.OffAir
        is NowPlayingState.Unreachable -> AirState.Unreachable
        is NowPlayingState.Answered -> {
            val now = state.reading.nowPlaying
            val track = now.track
            when {
                now.onAir && track != null -> AirState.OnAir(track)
                // On air with no track is a shape the contract says will not happen. Treated as
                // warming up rather than trusted, because the alternative is showing a record
                // that is not there.
                playbackRequested -> AirState.WarmingUp
                else -> AirState.OffAir
            }
        }
    }
