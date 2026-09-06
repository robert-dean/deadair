package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingUiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What the screen says.
 *
 * The wording is the part of this app most likely to be wrong and the part a screenshot is worst at
 * checking, and one line in particular has to land right: "off air" is the RESTING state of an
 * audience-gated station, so it must not read as a fault.
 */
class NowPlayingUiStateTest {
    private fun state(air: AirState, listeners: Long = 0, stale: Boolean = false, fellBack: Boolean = false) =
        NowPlayingUiState(
            air = air,
            listeners = listeners,
            format = StreamFormat.MP3,
            playing = false,
            buffering = false,
            fellBackToMp3 = fellBack,
            stale = stale,
        )

    private val track = NowPlayingTrack(title = "Windowlicker", artist = "Aphex Twin", album = "Windowlicker", startedAt = 1)

    @Test
    fun `names the record, the artist and the album when one is playing`() {
        val ui = state(AirState.OnAir(track))

        assertEquals("Windowlicker", ui.title)
        assertEquals("Aphex Twin", ui.subtitle)
        assertEquals("Windowlicker", ui.album)
    }

    @Test
    fun `says off air plainly, and says what the play button is for`() {
        // The surprising fact about an audience-gated station is that pressing play is what puts
        // it on air. A status line over the play button has to say that, or the button looks
        // pointless — which is what "nobody is listening" made it look like.
        val ui = state(AirState.OffAir)

        assertEquals("Off air", ui.title)
        assertEquals("Quiet until someone tunes in — press play to start it.", ui.subtitle)
    }

    @Test
    fun `says the station is coming on air rather than showing a stuck spinner`() {
        val ui = state(AirState.WarmingUp)

        assertEquals("Warming up", ui.title)
        assertEquals("The station is coming on air", ui.subtitle)
    }

    @Test
    fun `admits that what is on screen is stale when the station stops answering`() {
        assertEquals("Showing the last thing it said", state(AirState.Unreachable, stale = true).subtitle)
        assertNull(state(AirState.Unreachable, stale = false).subtitle)
    }

    @Test
    fun `counts listeners in words a person would use`() {
        assertEquals("Nobody listening · MP3", state(AirState.OffAir, listeners = 0).footer)
        assertEquals("1 listening · MP3", state(AirState.OffAir, listeners = 1).footer)
        assertEquals("12 listening · MP3", state(AirState.OffAir, listeners = 12).footer)
    }

    @Test
    fun `has no artist line for a record credited to nobody`() {
        val anonymous = NowPlayingTrack(title = "Untitled", artist = "", startedAt = 1)

        assertNull(state(AirState.OnAir(anonymous)).subtitle)
    }
}
