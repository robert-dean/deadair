package com.maroonedsoftware.deadair.widget

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingShow
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetSnapshotTest {
    private fun reading(
        station: String = "deadair",
        onAir: Boolean = true,
        track: NowPlayingTrack? = track(),
        show: NowPlayingShow? = null,
    ) = NowPlaying(station = station, onAir = onAir, listeners = 0, mounts = emptyList(), show = show, track = track)

    private fun track(
        kind: NowPlayingTrackKind = NowPlayingTrackKind.RECORD,
        title: String = "A Forest",
        artist: String = "The Cure",
    ) = NowPlayingTrack(title = title, artist = artist, kind = kind, startedAt = 0)

    @Test
    fun `a record becomes its title, its artist and its cover`() {
        val snapshot = snapshotOf(reading(track = track().copy(artworkUrl = "/api/art/7")), stationName = "kept", readAtMs = 10)

        assertEquals("deadair", snapshot.stationName)
        assertEquals("A Forest", snapshot.title)
        assertEquals("The Cure", snapshot.artist)
        assertEquals("/api/art/7", snapshot.artworkUrl)
        assertTrue(snapshot.onAir)
        assertTrue(snapshot.reachable)
        assertEquals(10L, snapshot.readAtMs)
    }

    @Test
    fun `the station's own name beats the one the setup screen kept`() {
        assertEquals("deadair", snapshotOf(reading(), stationName = "kept", readAtMs = 0).stationName)
        assertEquals("kept", snapshotOf(reading(station = ""), stationName = "kept", readAtMs = 0).stationName)
    }

    @Test
    fun `a break keeps who is saying it`() {
        val snapshot =
            snapshotOf(
                reading(track = track(kind = NowPlayingTrackKind.BREAK, title = "Ident", artist = ""), show = NowPlayingShow(name = "Late Static", host = "Cass")),
                stationName = null,
                readAtMs = 0,
            )

        assertEquals(NowPlayingTrackKind.BREAK, snapshot.kind)
        assertEquals("Ident", snapshot.title)
        // Empty rather than absent is what the contract says a break's artist is, and an empty
        // string drawn under a title is the line that looks like it failed to load.
        assertNull(snapshot.artist)
        assertEquals("Cass", snapshot.host)
    }

    @Test
    fun `off air clears the record rather than leaving the last one on the home screen`() {
        val snapshot = snapshotOf(reading(onAir = false, track = null), stationName = "kept", readAtMs = 0)

        assertFalse(snapshot.onAir)
        assertNull(snapshot.title)
        assertEquals("deadair", snapshot.stationName)
    }

    @Test
    fun `a reading that changes nothing drawn is not worth a write`() {
        val last = snapshotOf(reading(), stationName = null, readAtMs = 0)
        val again = snapshotOf(reading(), stationName = null, readAtMs = 3_000)

        assertFalse(worthDrawing(last, again))
    }

    @Test
    fun `a new record is`() {
        val last = snapshotOf(reading(), stationName = null, readAtMs = 0)
        val next = snapshotOf(reading(track = track(title = "Pictures of You")), stationName = null, readAtMs = 3_000)

        assertTrue(worthDrawing(last, next))
    }

    @Test
    fun `and so is an age a minute out of date, because the age is drawn too`() {
        val last = snapshotOf(reading(), stationName = null, readAtMs = 0)

        assertFalse(worthDrawing(last, last.copy(readAtMs = 59_000)))
        assertTrue(worthDrawing(last, last.copy(readAtMs = 60_000)))
    }

    @Test
    fun `the poll is only drawn when the gate is not going to say it better`() {
        assertTrue(takesHeard(WidgetPlayback.STOPPED))
        assertFalse(takesHeard(WidgetPlayback.WARMING_UP))
        assertFalse(takesHeard(WidgetPlayback.PLAYING))
    }
}
