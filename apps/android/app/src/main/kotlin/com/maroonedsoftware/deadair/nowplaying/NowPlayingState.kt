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

/**
 * The state a screen draws: the poll's, with the record swapped for the one this listener is hearing.
 *
 * While this phone is playing, the poll runs a buffer ahead of the audio: it names the next record
 * the moment the station commits it, and its playhead counts down the station's decoder rather than
 * the listener's ears. Drawn raw, Now playing changed title seconds before the music did, and before
 * the lock screen beside it, and its bar reached the end of a record that was still playing.
 * [aired] is `NowPlayingGate`'s released reading, already stamped for the ears, so it is what the
 * screen shows while [playing].
 *
 * Whether the station is ANSWERING stays the poll's to say, for the widget's reason: one failed
 * request is still shown as one, over the record that is still playing. Stopped, or before the
 * gate has released anything this session, the poll's reading is all there is and is drawn as is.
 */
fun NowPlayingState.heard(aired: Reading?, playing: Boolean): NowPlayingState {
    if (!playing || aired == null) return this
    return when (this) {
        is NowPlayingState.Answered -> NowPlayingState.Answered(aired)
        is NowPlayingState.Unreachable -> NowPlayingState.Unreachable(aired)
        // The poll restarted (a station change) and has not answered yet: whatever was released
        // belongs to the session before it.
        NowPlayingState.Loading -> this
    }
}
