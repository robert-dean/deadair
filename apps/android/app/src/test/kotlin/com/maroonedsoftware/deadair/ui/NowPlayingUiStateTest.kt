package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.sdk.models.NowPlayingShow
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
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
    private fun state(air: AirState, listeners: Long = 0, stale: Boolean = false, fellBack: Boolean = false, show: NowPlayingShow? = null) =
        NowPlayingUiState(
            air = air,
            listeners = listeners,
            format = StreamFormat.MP3,
            playing = false,
            buffering = false,
            fellBackToMp3 = fellBack,
            stale = stale,
            show = show,
        )

    /** The station talking between records, as `/nowplaying` reports it: its own label, no artist. */
    private val spoken = NowPlayingTrack(kind = NowPlayingTrackKind.BREAK, title = "Top of the hour", artist = "", startedAt = 1)

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
    fun `scrolls a credit and wraps a sentence`() {
        // The marquee is for a long artist line. Scrolled, the off-air sentence lost its first word.
        assertEquals(true, state(AirState.OnAir(track)).subtitleScrolls)
        assertEquals(false, state(AirState.OffAir).subtitleScrolls)
        assertEquals(false, state(AirState.WarmingUp).subtitleScrolls)
    }

    @Test
    fun `has no artist line for a record credited to nobody`() {
        val anonymous = NowPlayingTrack(title = "Untitled", artist = "", startedAt = 1)

        assertNull(state(AirState.OnAir(anonymous)).subtitle)
    }

    @Test
    fun `names the show and its host above the record`() {
        val ui = state(AirState.OnAir(track), show = NowPlayingShow(name = "Late Static", host = "Cass"))

        assertEquals(Message.ShowWithHost("Late Static", "Cass"), ui.header)
    }

    @Test
    fun `names a show nobody presents as the station wrote it`() {
        assertEquals(Message.Text("Overnight"), state(AirState.OnAir(track), show = NowPlayingShow(name = "Overnight")).header)
    }

    @Test
    fun `names the host alone when the show has no name to give`() {
        // A broadcast's name can be blank: it is the operator's own label, and nothing requires one.
        assertEquals(Message.WithHost("Cass"), state(AirState.OnAir(track), show = NowPlayingShow(name = "", host = "Cass")).header)
    }

    @Test
    fun `has no header when the station names no show, or is not on air`() {
        assertNull(state(AirState.OnAir(track)).header)
        assertNull(state(AirState.OnAir(track), show = NowPlayingShow(name = "")).header)
        // A stale show over "can't reach the station" would name something nobody can hear.
        assertNull(state(AirState.Unreachable, stale = true, show = NowPlayingShow(name = "Late Static", host = "Cass")).header)
    }

    @Test
    fun `says the host is on the mic during a break, with the break's label under it`() {
        val ui = state(AirState.OnAir(spoken), show = NowPlayingShow(name = "Late Static", host = "Cass"))

        assertEquals(Message.OnTheMic("Cass"), ui.title)
        assertEquals(Message.Text("Top of the hour"), ui.subtitle)
        // A break has no album, and the header already says which show this is.
        assertNull(ui.album)
    }

    @Test
    fun `says the host is on the mic even when the station names nobody`() {
        assertEquals(Message.OnTheMic(null), state(AirState.OnAir(spoken)).title)
        assertEquals(Message.OnTheMic(null), state(AirState.OnAir(spoken), show = NowPlayingShow(name = "Overnight")).title)
    }

    @Test
    fun `treats a record from a station older than kind as a record`() {
        // The SDK's default: a station that predates the field sends no kind, and that is a record.
        val ui = state(AirState.OnAir(NowPlayingTrack(title = "Windowlicker", artist = "Aphex Twin", startedAt = 1)))

        assertEquals(Message.Text("Windowlicker"), ui.title)
    }
}
