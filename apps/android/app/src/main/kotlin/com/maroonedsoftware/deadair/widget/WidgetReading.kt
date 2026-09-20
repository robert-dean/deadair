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

/**
 * Everything the widget draws from: what the station was doing, what this phone is doing about it,
 * and the two things only this process knows.
 *
 * [operator] is a cached role and a HINT, never a gate — the API decides every press, and a control
 * drawn on a stale answer can still be refused. [skipArmed] is deliberately not persisted: a process
 * that died forgets it, which is the safe way round for a control that cuts everybody's record.
 */
data class WidgetState(
    val snapshot: WidgetSnapshot = WidgetSnapshot(),
    val playback: WidgetPlayback = WidgetPlayback.STOPPED,
    val operator: Boolean = false,
    val skipArmed: Boolean = false,
)

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

    /**
     * The station is not airing anything, and this phone is not asking it to.
     *
     * Only reachable under [WidgetFollows.STATION]: resting, the widget does not know whether the
     * station is off air or simply not asked, and those are the same answer from a station that
     * airs only while somebody is listening.
     */
    data object OffAir : WidgetReading

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
fun widgetReading(
    hasStation: Boolean,
    follows: WidgetFollows,
    playback: WidgetPlayback,
    snapshot: WidgetSnapshot,
): WidgetReading {
    if (!hasStation) return WidgetReading.NoStation
    // Following this phone and not playing, the widget has asked nothing and says so. Following the
    // station, it draws what it was last told, however that reading was come by.
    if (playback == WidgetPlayback.STOPPED && follows == WidgetFollows.THIS_PHONE) return WidgetReading.Resting
    if (!snapshot.reachable) return WidgetReading.Unreachable

    val title = snapshot.title?.ifBlank { null }
    // Nothing on while this phone is asking for audio is warming up, never off air; nothing on
    // while it is NOT asking is simply off air, which is an ordinary state for this station.
    if (!snapshot.onAir || title == null) {
        return if (playback == WidgetPlayback.STOPPED) WidgetReading.OffAir else WidgetReading.WarmingUp
    }

    return if (snapshot.kind == NowPlayingTrackKind.BREAK) {
        WidgetReading.Break(host = snapshot.host, label = title)
    } else {
        WidgetReading.Record(title = title, artist = snapshot.artist?.ifBlank { null })
    }
}

/**
 * Whether the operator's Skip is drawn.
 *
 * Two conditions and both matter. The account has to be the station's, or a listener would be given
 * a button that 403s — the same argument every withdrawn control in this app rests on. And the
 * widget has to be showing what is ON, because otherwise it does not know whether there is anything
 * to cut: resting, it has not asked the station anything.
 */
fun offersSkip(operator: Boolean, reading: WidgetReading): Boolean =
    operator && (reading is WidgetReading.Record || reading is WidgetReading.Break)

/**
 * When the reading on the widget was taken, if that is worth saying.
 *
 * Only while following the station with nothing playing here: the rest of the time what is drawn is
 * either seconds old (something in this app is polling) or is not a reading at all. Two minutes
 * because a record is three, so an older reading is no longer safely "what is playing" — and a
 * widget that names the wrong record with no hedge is worse than one that admits its age.
 */
fun asOf(follows: WidgetFollows, playback: WidgetPlayback, snapshot: WidgetSnapshot, now: Long): Long? {
    if (follows != WidgetFollows.STATION || playback != WidgetPlayback.STOPPED) return null
    if (snapshot.readAtMs <= 0L) return null
    return snapshot.readAtMs.takeIf { now - it >= WIDGET_STALE_MS }
}
