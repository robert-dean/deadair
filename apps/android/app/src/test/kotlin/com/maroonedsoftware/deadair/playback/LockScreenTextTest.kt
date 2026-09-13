package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingShow
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What the lock screen, the notification and a head unit read.
 *
 * The words stand in for `strings.xml` here, so what is asserted is which line says what: the
 * failure this exists for is a break arriving with an empty artist and the notification showing a
 * title over nothing.
 */
class LockScreenTextTest {
    private val words = LockScreenWords(offAir = "Off air", onTheMic = { host -> if (host == null) "The host is on the mic" else "$host is on the mic" })

    private fun reading(track: NowPlayingTrack?, show: NowPlayingShow? = null) =
        NowPlaying(station = "Static", onAir = track != null, listeners = 1, mounts = emptyList(), show = show, track = track)

    @Test
    fun `a record is its title over its artist, with its album`() {
        val text = lockScreenText(reading(NowPlayingTrack(title = "Windowlicker", artist = "Aphex Twin", album = "Windowlicker", startedAt = 1)), words)

        assertEquals(LockScreenText(title = "Windowlicker", artist = "Aphex Twin", album = "Windowlicker"), text)
    }

    @Test
    fun `a break puts the host on the title line and the label under it, not an empty credit`() {
        val spoken = NowPlayingTrack(kind = NowPlayingTrackKind.BREAK, title = "Top of the hour", artist = "", startedAt = 1)

        val text = lockScreenText(reading(spoken, NowPlayingShow(name = "Late Static", host = "Cass")), words)

        assertEquals(LockScreenText(title = "Cass is on the mic", artist = "Top of the hour", album = "Late Static"), text)
    }

    @Test
    fun `a break with nobody named still says somebody is talking`() {
        val spoken = NowPlayingTrack(kind = NowPlayingTrackKind.BREAK, title = "Ident", artist = "", startedAt = 1)

        assertEquals(LockScreenText(title = "The host is on the mic", artist = "Ident", album = null), lockScreenText(reading(spoken), words))
    }

    @Test
    fun `off air is the station's name over the off-air line`() {
        assertEquals(LockScreenText(title = "Static", artist = "Off air", album = null), lockScreenText(reading(null), words))
    }

    @Test
    fun `nothing is said before the station has answered`() {
        // "Off air" as a guess would be wrong exactly when the listener has just pressed play.
        assertEquals(LockScreenText(title = null, artist = null, album = null), lockScreenText(null, words))
    }
}
