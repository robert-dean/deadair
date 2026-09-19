package com.maroonedsoftware.deadair.ui.desk

import com.maroonedsoftware.deadair.nowplaying.clockOf
import com.maroonedsoftware.deadair.ui.nowplaying.SilenceReading
import com.maroonedsoftware.deadair.ui.nowplaying.TransportUiState
import com.maroonedsoftware.deadair.ui.text.Message

/** The record on air, as the desk names it. */
data class DeskRecord(val title: String, val artworkUrl: String?, val line: Message)

/**
 * What the desk says above its controls: on or off air, and in what words.
 *
 * On air is the station's own verdict (`silence.audible`, through the reading's tone), not whether
 * the stream is up or the air is active: either can be true of a station nobody can hear, and the
 * heading is the answer to "can anyone hear this". Off air, the line under it is the station's
 * title for why, the same words the panel below opens on, so the two cannot disagree.
 */
data class DeskUiState(val transport: TransportUiState, val silence: SilenceReading) {
    val onAir: Boolean get() = silence.live

    val heading: Message get() = if (onAir) Message.DeskOnAir else Message.DeskOffAir

    val line: Message
        get() =
            if (onAir) {
                Message.GoingOut(name = transport.air?.name?.takeIf { it.isNotBlank() }, listeners = transport.status.listeners)
            } else {
                silence.title
            }

    /** What is on, with what is left of it when the station says. Nothing between records. */
    val record: DeskRecord?
        get() =
            transport.status.nowPlaying?.let { now ->
                val artists = now.item.artists.joinToString(", ")
                DeskRecord(
                    title = now.item.title,
                    artworkUrl = now.item.artworkUrl,
                    line = now.remainingMs?.let { Message.TimeLeft(artists, clockOf(it)) } ?: Message.Text(artists),
                )
            }
}
