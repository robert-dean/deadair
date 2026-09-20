package com.maroonedsoftware.deadair.widget

import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WidgetFollowsTest {
    private val onAir =
        WidgetSnapshot(
            stationName = "deadair",
            onAir = true,
            kind = NowPlayingTrackKind.RECORD,
            title = "A Forest",
            artist = "The Cure",
            readAtMs = 1_000_000L,
        )

    private fun reading(follows: WidgetFollows, playback: WidgetPlayback, snapshot: WidgetSnapshot = onAir) =
        widgetReading(hasStation = true, follows = follows, playback = playback, snapshot = snapshot)

    @Test
    fun `following this phone, a stopped player rests whatever the station is doing`() {
        assertEquals(WidgetReading.Resting, reading(WidgetFollows.THIS_PHONE, WidgetPlayback.STOPPED))
    }

    @Test
    fun `following the station, a stopped player draws what is on`() {
        assertEquals(WidgetReading.Record("A Forest", "The Cure"), reading(WidgetFollows.STATION, WidgetPlayback.STOPPED))
    }

    @Test
    fun `following the station with nothing on is off air, not warming up`() {
        val quiet = onAir.copy(onAir = false, title = null, artist = null)

        assertEquals(WidgetReading.OffAir, reading(WidgetFollows.STATION, WidgetPlayback.STOPPED, quiet))
        // Asking for audio is what separates the two, exactly as `airState` has it.
        assertEquals(WidgetReading.WarmingUp, reading(WidgetFollows.STATION, WidgetPlayback.WARMING_UP, quiet))
    }

    @Test
    fun `playing draws the record under either setting`() {
        assertEquals(WidgetReading.Record("A Forest", "The Cure"), reading(WidgetFollows.THIS_PHONE, WidgetPlayback.PLAYING))
        assertEquals(WidgetReading.Record("A Forest", "The Cure"), reading(WidgetFollows.STATION, WidgetPlayback.PLAYING))
    }

    @Test
    fun `the age is shown only when it is old, and only when nothing here is playing`() {
        val fresh = onAir.readAtMs + WIDGET_STALE_MS - 1
        val stale = onAir.readAtMs + WIDGET_STALE_MS

        assertNull(asOf(WidgetFollows.STATION, WidgetPlayback.STOPPED, onAir, fresh))
        assertEquals(onAir.readAtMs, asOf(WidgetFollows.STATION, WidgetPlayback.STOPPED, onAir, stale))
        // Playing, the reading is seconds old by construction: something in this app is polling.
        assertNull(asOf(WidgetFollows.STATION, WidgetPlayback.PLAYING, onAir, stale))
        // Resting, there is nothing drawn for an age to belong to.
        assertNull(asOf(WidgetFollows.THIS_PHONE, WidgetPlayback.STOPPED, onAir, stale))
        // And a snapshot nothing has ever been written into has no age to show.
        assertNull(asOf(WidgetFollows.STATION, WidgetPlayback.STOPPED, WidgetSnapshot(), stale))
    }
}
