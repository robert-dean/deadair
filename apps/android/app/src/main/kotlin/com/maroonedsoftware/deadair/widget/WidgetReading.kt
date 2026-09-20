package com.maroonedsoftware.deadair.widget

import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind

/**
 * What this phone is doing about the station, as the widget needs it.
 *
 * Three states rather than two, for the reason the Quick Settings tile has four: the seconds after
 * a press are warm-up, and a surface that sat at "off" through them would look like the press had
 * not landed.
 */
enum class WidgetPlayback {
    STOPPED,

    /** Asked for, and nothing coming out yet. */
    WARMING_UP,
    PLAYING,
}

/** Read from `playWhenReady` rather than `isPlaying`, as every other surface's button is, so they cannot disagree. */
fun widgetPlayback(requested: Boolean, playing: Boolean): WidgetPlayback =
    when {
        !requested -> WidgetPlayback.STOPPED
        playing -> WidgetPlayback.PLAYING
        else -> WidgetPlayback.WARMING_UP
    }

/** Everything the widget draws from: what the station was doing, and what this phone is doing about it. */
data class WidgetState(val snapshot: WidgetSnapshot = WidgetSnapshot(), val playback: WidgetPlayback = WidgetPlayback.STOPPED)

/**
 * What the widget says.
 *
 * Its own type rather than the lock screen's [com.maroonedsoftware.deadair.playback.lockScreenText]
 * or the screen's `NowPlayingUiState`, because the three surfaces answer differently and always
 * have: a notification must have a title, so off air it borrows the station's name for one, and a
 * widget has a header of its own to put that in. Every surface deciding its own words, purely and
 * under test, is the pattern those two already set.
 */
sealed interface WidgetReading {
    /** Nothing has been chosen yet. The app is where a station is named, and tapping the widget opens it. */
    data object NoStation : WidgetReading

    /**
     * This phone is not listening, and the widget is not asking the station anything.
     *
     * The wallpaper's rule, for the wallpaper's reason: a surface that exists for as long as the
     * phone is on must not poll for as long as the phone is on.
     */
    data object Resting : WidgetReading

    data object WarmingUp : WidgetReading

    /** Listening, and the station is not answering what it is playing. The audio may well be fine. */
    data object Unreachable : WidgetReading

    data class Record(val title: String, val artist: String?) : WidgetReading

    /** The station talking between records. [label] is the break's own name, and [host] whoever is saying it. */
    data class Break(val host: String?, val label: String?) : WidgetReading
}

/**
 * What to say, from the kept station, this phone and the last snapshot.
 *
 * The order is `airState`'s and for its reasons: a station that is not airing while this phone is
 * asking for audio is WARMING UP, never off air, because those are the same answer from the station
 * and what separates them is whether anybody is currently asking it for anything.
 */
fun widgetReading(hasStation: Boolean, playback: WidgetPlayback, snapshot: WidgetSnapshot): WidgetReading {
    if (!hasStation) return WidgetReading.NoStation
    if (playback == WidgetPlayback.STOPPED) return WidgetReading.Resting
    if (!snapshot.reachable) return WidgetReading.Unreachable

    val title = snapshot.title?.ifBlank { null }
    if (!snapshot.onAir || title == null) return WidgetReading.WarmingUp

    return if (snapshot.kind == NowPlayingTrackKind.BREAK) {
        WidgetReading.Break(host = snapshot.host, label = title)
    } else {
        WidgetReading.Record(title = title, artist = snapshot.artist?.ifBlank { null })
    }
}
