package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind

/**
 * The picture that stands for what is on air, as the station's own path: resolve it with
 * `StationUrl.artUrl` like any cover.
 *
 * A record's cover whenever there is one. During a break, which has none, the presenter's portrait,
 * because the presenter IS what is on air then and the station's radio glyph said nothing about
 * who. A persona with no picture, or a station too old to send one, leaves this `null` and every
 * surface draws its placeholder exactly as before.
 *
 * One answer for the screen, the player bar, the lock screen and the widget, so the four cannot
 * disagree about what a break looks like.
 */
fun NowPlaying?.coverPath(): String? {
    val track = this?.track ?: return null
    track.artworkUrl?.ifBlank { null }?.let { return it }
    if (track.kind != NowPlayingTrackKind.BREAK) return null
    return show?.hostArtUrl?.ifBlank { null }
}
