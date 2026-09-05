package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlaying

/** One answer from the station, and when it was read. */
data class Reading(val nowPlaying: NowPlaying, val readAtMs: Long)

/** What the app knows about the station right now. */
sealed interface NowPlayingState {
    /** Before the first answer. Not an error, and not "off air" either. */
    data object Loading : NowPlayingState

    data class Answered(val reading: Reading) : NowPlayingState

    /**
     * The station stopped answering, carrying the last good reading with it.
     *
     * Kept rather than discarded because a poll that fails once is ordinary — a phone changing
     * network, a tunnel reconnecting — and blanking the screen for it would make every hiccup look
     * like the station going away. What is showing is stale and the UI says so; it does not vanish.
     */
    data class Unreachable(val lastGood: Reading?) : NowPlayingState
}
