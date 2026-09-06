package com.maroonedsoftware.deadair.ui.nowplaying

import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.station.StreamFormat

/**
 * The screen, as data.
 *
 * Separated from the Compose code so the one thing worth testing here — what the status line SAYS —
 * is a function a JVM test can call. The words matter: "off air" has to read as an ordinary state
 * and not as a fault, because on an audience-gated station it is what quiet looks like.
 */
data class NowPlayingUiState(
    val air: AirState,
    val listeners: Long,
    val format: StreamFormat,
    val playing: Boolean,
    val buffering: Boolean,
    /** True when the chosen format was not published and MP3 was taken instead. */
    val fellBackToMp3: Boolean = false,
    /** Whether what is on screen came from a reading that has since gone stale. */
    val stale: Boolean = false,
) {
    val title: String
        get() = when (val state = air) {
            is AirState.OnAir -> state.track.title
            AirState.WarmingUp -> "Warming up"
            AirState.OffAir -> "Off air"
            AirState.Unreachable -> "Can't reach the station"
        }

    val subtitle: String?
        get() = when (val state = air) {
            is AirState.OnAir -> state.track.artist.ifBlank { null }
            // An invitation rather than a status. On an audience-gated station this is the normal
            // resting state, and the surprising fact about it is that pressing play is what puts
            // the station on air — a line that read "nobody is listening" over a play button made
            // the button look pointless, when it was the whole answer.
            AirState.OffAir -> "Quiet until someone tunes in — press play to start it."
            AirState.WarmingUp -> "The station is coming on air"
            AirState.Unreachable -> if (stale) "Showing the last thing it said" else null
        }

    val album: String?
        get() = (air as? AirState.OnAir)?.track?.album

    /** The line under the controls: who is listening, and how. */
    val footer: String
        get() {
            val people = when (listeners) {
                0L -> "Nobody listening"
                1L -> "1 listening"
                else -> "$listeners listening"
            }
            return "$people · ${format.label}"
        }
}
