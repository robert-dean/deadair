package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind

/**
 * The app's own words the lock screen needs, resolved once from `strings.xml` by the service.
 *
 * Carried in rather than looked up here so that [lockScreenText] stays free of `android.*` and a
 * JVM test can say what the lock screen reads. The words themselves live in `strings.xml`, as every
 * sentence in this app does.
 */
data class LockScreenWords(val offAir: String, val onTheMic: (host: String?) -> String)

/** The three lines the lock screen, the notification and a Bluetooth head unit show. */
data class LockScreenText(val title: String?, val artist: String?, val album: String?)

/**
 * What the lock screen says about [now].
 *
 * A record is its title over its artist. While the station talks between records the artist is
 * EMPTY, and a title over nothing is the notification that looks like it failed to load; so the
 * title says who is talking, the break's own label goes on the artist line, and the show takes the
 * album line where there is one.
 *
 * With nothing on air the station's name takes the title and `offAir` the artist line, but only
 * once the station has answered: before the first reading nothing is known, and "Off air" as a
 * guess would be wrong exactly when the listener has just pressed play.
 */
fun lockScreenText(now: NowPlaying?, words: LockScreenWords): LockScreenText {
    val track = now?.track ?: return LockScreenText(title = now?.station, artist = words.offAir.takeIf { now != null }, album = null)
    if (track.kind == NowPlayingTrackKind.BREAK) {
        return LockScreenText(
            title = words.onTheMic(now.show?.host?.ifBlank { null }),
            artist = track.title,
            album = now.show?.name?.ifBlank { null },
        )
    }
    return LockScreenText(title = track.title, artist = track.artist, album = track.album)
}
