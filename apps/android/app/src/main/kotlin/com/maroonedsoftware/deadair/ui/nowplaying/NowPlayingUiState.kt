package com.maroonedsoftware.deadair.ui.nowplaying

import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.sdk.models.NowPlayingShow
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.text.Message

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
    /**
     * The programme on air, as the station last described it. A station-level fact rather than the
     * record's, which is why it rides here and not on [AirState.OnAir].
     */
    val show: NowPlayingShow? = null,
) {
    /** What is on air when it is the station talking between records rather than a record. */
    private val spokenBreak: NowPlayingTrack?
        get() = (air as? AirState.OnAir)?.track?.takeIf { it.kind == NowPlayingTrackKind.BREAK }

    /**
     * During a break, who is talking rather than the break's label: a listener glancing at the
     * screen wants to know the music stopped because the host is on, and the label ("Top of the
     * hour") is the station's own filing name for it. It is app copy, so it never marquees.
     */
    val title: Message
        get() = when (val state = air) {
            is AirState.OnAir -> if (spokenBreak != null) Message.OnTheMic(show?.host?.ifBlank { null }) else Message.Text(state.track.title)
            AirState.WarmingUp -> Message.WarmingUp
            AirState.OffAir -> Message.OffAir
            AirState.Unreachable -> Message.CantReachStation
        }

    val subtitle: Message?
        get() = when (val state = air) {
            // A break has no artist, so its label goes where the artist would.
            is AirState.OnAir -> (if (spokenBreak != null) state.track.title else state.track.artist).ifBlank { null }?.let(Message::Text)
            // An invitation rather than a status. On an audience-gated station this is the normal
            // resting state, and the surprising fact about it is that pressing play is what puts
            // the station on air — a line that read "nobody is listening" over a play button made
            // the button look pointless, when it was the whole answer.
            AirState.OffAir -> Message.QuietUntilSomeoneTunesIn
            AirState.WarmingUp -> Message.ComingOnAir
            AirState.Unreachable -> if (stale) Message.ShowingLastSaid else null
        }

    val album: String?
        get() = if (spokenBreak != null) null else (air as? AirState.OnAir)?.track?.album

    /**
     * The line above the record: the show and who presents it, as far as the station said. Only on
     * air, because a quiet station has no programme, and a stale show over "can't reach the
     * station" would name something nobody can hear.
     */
    val header: Message?
        get() {
            if (air !is AirState.OnAir) return null
            val name = show?.name?.ifBlank { null }
            val host = show?.host?.ifBlank { null }
            return when {
                name != null && host != null -> Message.ShowWithHost(name, host)
                name != null -> Message.Text(name)
                host != null -> Message.WithHost(host)
                else -> null
            }
        }

    /**
     * Whether the subtitle is a credit that may scroll past, or a sentence that has to wrap.
     *
     * A long artist line scrolls the way it does on every player a listener has used. App copy
     * does not: the off-air line is a whole sentence, and a marquee that scrolled it showed a
     * listener the middle of an instruction with its first word gone.
     */
    val subtitleScrolls: Boolean
        get() = subtitle is Message.Text

    /** The line under the controls: who is listening, and how. The count is spelled by the language, not here. */
    val footer: Message
        get() = Message.Listeners(listeners, format)

    /** Said only when the chosen format was not there to be had. */
    val fallbackNote: Message?
        get() = if (fellBackToMp3) Message.FellBackToMp3(format) else null
}
