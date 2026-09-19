package com.maroonedsoftware.deadair.ui.desk

import com.maroonedsoftware.deadair.sdk.models.AirMode
import com.maroonedsoftware.deadair.sdk.models.AirSource
import com.maroonedsoftware.deadair.sdk.models.PlayoutItem
import com.maroonedsoftware.deadair.sdk.models.PlayoutNowPlaying
import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.sdk.models.SilenceCheck
import com.maroonedsoftware.deadair.sdk.models.SilenceState
import com.maroonedsoftware.deadair.sdk.models.StationAir
import com.maroonedsoftware.deadair.sdk.models.StationSilence
import com.maroonedsoftware.deadair.ui.nowplaying.TransportUiState
import com.maroonedsoftware.deadair.ui.nowplaying.readSilence
import com.maroonedsoftware.deadair.ui.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the desk says above its controls. The rule worth pinning is that "on air" is the station's verdict on whether anything can be heard. */
class DeskUiStateTest {
    private val airing = StationSilence(audible = true, cause = SilenceCause.AIRING, detail = "", checks = emptyList())

    private fun status(
        silence: StationSilence = airing,
        streamUp: Boolean = true,
        listeners: Long = 9,
        playing: PlayoutNowPlaying? = PlayoutNowPlaying(item = PlayoutItem(id = "i", pluginId = "p", externalId = "x", title = "Carriageway", artists = listOf("Pale Arcs", "Guest")), startedAt = 0, remainingMs = 153_000),
    ) = PlayoutStatus(
        streamUp = streamUp,
        onAir = silence.audible,
        mountPath = "/live",
        mounts = emptyList(),
        nowPlaying = playing,
        upNext = emptyList(),
        queuedCount = 0,
        listeners = listeners,
        audience = true,
        staleStreamConfig = emptyList(),
        silence = silence,
    )

    private fun air(name: String? = "Afternoon Drift") = StationAir(active = true, airMode = AirMode.AUDIENCE, name = name, remaining = 3, airSource = AirSource.SCHEDULE, held = false)

    private fun desk(status: PlayoutStatus, air: StationAir? = air()) = DeskUiState(TransportUiState(status, air), readSilence(status.silence))

    @Test
    fun `on air names the broadcast and how many are listening`() {
        val ui = desk(status())

        assertTrue(ui.onAir)
        assertEquals(Message.DeskOnAir, ui.heading)
        assertEquals(Message.GoingOut("Afternoon Drift", 9), ui.line)
    }

    @Test
    fun `a broadcast with no name is going out all the same`() {
        assertEquals(Message.GoingOut(null, 9), desk(status(), air(name = "")).line)
        assertEquals(Message.GoingOut(null, 9), desk(status(), air = null).line)
    }

    @Test
    fun `off air is the station's verdict, and the line is its own title for why`() {
        val refused =
            StationSilence(
                audible = false,
                cause = SilenceCause.CONTROL_DENIED,
                detail = "",
                checks = listOf(SilenceCheck(SilenceCause.CONTROL_DENIED, SilenceState.FAULT, "")),
            )
        // The stream being up does not make a station anybody can hear.
        val ui = desk(status(silence = refused, streamUp = true))

        assertFalse(ui.onAir)
        assertEquals(Message.DeskOffAir, ui.heading)
        assertEquals(Message.SilenceTitle(SilenceCause.CONTROL_DENIED), ui.line)
    }

    @Test
    fun `the record says what is left of it when the station does`() {
        val record = desk(status()).record!!

        assertEquals("Carriageway", record.title)
        assertEquals(Message.TimeLeft("Pale Arcs, Guest", "2:33"), record.line)
    }

    @Test
    fun `without a remaining time the record is just its artists, and between records there is none`() {
        val playing = PlayoutNowPlaying(item = PlayoutItem(id = "i", pluginId = "p", externalId = "x", title = "t", artists = listOf("a")), startedAt = 0)

        assertEquals(Message.Text("a"), desk(status(playing = playing)).record?.line)
        assertNull(desk(status(playing = null)).record)
    }
}
