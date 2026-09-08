package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.sdk.models.AirMode
import com.maroonedsoftware.deadair.sdk.models.AirSource
import com.maroonedsoftware.deadair.sdk.models.PlayoutItem
import com.maroonedsoftware.deadair.sdk.models.PlayoutNowPlaying
import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.sdk.models.StationAir
import com.maroonedsoftware.deadair.sdk.models.StationSilence
import com.maroonedsoftware.deadair.ui.nowplaying.HoldUi
import com.maroonedsoftware.deadair.ui.nowplaying.TransportUiState
import com.maroonedsoftware.deadair.ui.text.Clock
import com.maroonedsoftware.deadair.ui.text.Message
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The console's rules for the transport, so a phone and a laptop never disagree about whether a button is worth pressing. */
class TransportUiStateTest {
    private fun status(streamUp: Boolean = true, playing: Boolean = true) =
        PlayoutStatus(
            streamUp = streamUp,
            onAir = playing,
            mountPath = "/live",
            mounts = emptyList(),
            nowPlaying =
                if (playing) PlayoutNowPlaying(item = PlayoutItem(id = "i", pluginId = "p", externalId = "x", title = "t", artists = listOf("a")), startedAt = 0) else null,
            upNext = emptyList(),
            queuedCount = 0,
            listeners = 1,
            audience = true,
            staleStreamConfig = emptyList(),
            silence = StationSilence(audible = playing, cause = SilenceCause.AIRING, detail = "", checks = emptyList()),
        )

    private fun air(active: Boolean = true, source: AirSource = AirSource.SCHEDULE, held: Boolean = false, holdUntil: String? = null) =
        StationAir(active = active, airMode = AirMode.AUDIENCE, remaining = 2, airSource = source, held = held, holdUntil = holdUntil)

    @Test
    fun `skip needs a stream and something on it`() {
        assertTrue(TransportUiState(status(), air()).skipEnabled)
        assertFalse(TransportUiState(status(streamUp = false), air()).skipEnabled)
        assertFalse(TransportUiState(status(playing = false), air()).skipEnabled)
        assertFalse(TransportUiState(status(), air(), busy = true).skipEnabled)
    }

    @Test
    fun `start replaces stop only once the station is known to be stood down`() {
        assertTrue(TransportUiState(status(playing = false), air(active = false)).showsStart)
        assertFalse(TransportUiState(status(), air(active = true)).showsStart)
        // Unknown is not stood down.
        assertFalse(TransportUiState(status(), air = null).showsStart)
    }

    @Test
    fun `says who is driving, and nothing while the station is off`() {
        assertEquals(Message.SchedulePutThisOn, TransportUiState(status(), air(source = AirSource.SCHEDULE)).driving)
        assertEquals(Message.BetweenBlocks, TransportUiState(status(), air(source = AirSource.SUSTAINING)).driving)
        assertEquals(Message.YouPutThisOn, TransportUiState(status(), air(source = AirSource.OPERATOR)).driving)
        assertNull(TransportUiState(status(), air(source = AirSource.OFF)).driving)
        assertNull(TransportUiState(status(), air = null).driving)
    }

    @Test
    fun `offers a hold only while a person is driving`() {
        assertNull(TransportUiState(status(), air(source = AirSource.SCHEDULE)).hold)
        assertEquals(HoldUi.Offered, TransportUiState(status(), air(source = AirSource.OPERATOR)).hold)
    }

    @Test
    fun `an absent holdUntil while held is the hold that never lapses`() {
        assertEquals(HoldUi.HeldUntilReleased, TransportUiState(status(), air(source = AirSource.OPERATOR, held = true)).hold)
    }

    @Test
    fun `a timed hold reads in the phone's own zone`() {
        val state = TransportUiState(status(), air(source = AirSource.OPERATOR, held = true, holdUntil = "2026-09-06T21:30:00Z"), zone = ZoneId.of("Europe/London"))

        assertEquals(HoldUi.HeldUntil(Clock(22, 30)), state.hold)
    }
}
