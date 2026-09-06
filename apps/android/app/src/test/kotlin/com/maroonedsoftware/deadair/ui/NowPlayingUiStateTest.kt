package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingUiState
import com.maroonedsoftware.deadair.ui.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What the screen says.
 *
 * Asserted as `Message` values rather than sentences: the sentences live in `strings.xml`, where
 * they can be translated, and what this guards is that the right one is chosen. One choice in
 * particular has to land right: "off air" is the RESTING state of an audience-gated station, so it
 * must not be the fault message.
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

        assertEquals(Message.Text("Windowlicker"), ui.title)
        assertEquals(Message.Text("Aphex Twin"), ui.subtitle)
        assertEquals("Windowlicker", ui.album)
    }

    @Test
    fun `says off air plainly, and says what the play button is for`() {
        // The surprising fact about an audience-gated station is that pressing play is what puts
        // it on air. A status line over the play button has to say that, or the button looks
        // pointless — which is what "nobody is listening" made it look like.
        val ui = state(AirState.OffAir)

        assertEquals(Message.OffAir, ui.title)
        assertEquals(Message.QuietUntilSomeoneTunesIn, ui.subtitle)
    }

    @Test
    fun `says the station is coming on air rather than showing a stuck spinner`() {
        val ui = state(AirState.WarmingUp)

        assertEquals(Message.WarmingUp, ui.title)
        assertEquals(Message.ComingOnAir, ui.subtitle)
    }

    @Test
    fun `admits that what is on screen is stale when the station stops answering`() {
        assertEquals(Message.CantReachStation, state(AirState.Unreachable, stale = true).title)
        assertEquals(Message.ShowingLastSaid, state(AirState.Unreachable, stale = true).subtitle)
        assertNull(state(AirState.Unreachable, stale = false).subtitle)
    }

    @Test
    fun `hands the listener count to the language to count`() {
        // The plural forms are the resource's job: a language with three of them cannot be served
        // by a `when` on zero, one and many written in Kotlin.
        assertEquals(Message.Listeners(0, StreamFormat.MP3), state(AirState.OffAir, listeners = 0).footer)
        assertEquals(Message.Listeners(12, StreamFormat.MP3), state(AirState.OffAir, listeners = 12).footer)
    }

    @Test
    fun `notes the fallback only when it happened`() {
        assertEquals(Message.FellBackToMp3(StreamFormat.MP3), state(AirState.OffAir, fellBack = true).fallbackNote)
        assertNull(state(AirState.OffAir).fallbackNote)
    }

    @Test
    fun `has no artist line for a record credited to nobody`() {
        val anonymous = NowPlayingTrack(title = "Untitled", artist = "", startedAt = 1)

        assertNull(state(AirState.OnAir(anonymous)).subtitle)
    }
}
