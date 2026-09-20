package com.maroonedsoftware.deadair.widget

import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrackKind
import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetReadingTest {
    private val onAir =
        WidgetSnapshot(stationName = "deadair", onAir = true, kind = NowPlayingTrackKind.RECORD, title = "A Forest", artist = "The Cure")

    /** Every case here is the default setting; what the other one changes is `WidgetFollowsTest`. */
    private fun reading(hasStation: Boolean = true, playback: WidgetPlayback, snapshot: WidgetSnapshot = onAir) =
        widgetReading(hasStation = hasStation, follows = WidgetFollows.THIS_PHONE, playback = playback, snapshot = snapshot)

    @Test
    fun `nothing kept is nothing to draw`() {
        assertEquals(WidgetReading.NoStation, reading(hasStation = false, playback = WidgetPlayback.PLAYING, snapshot = onAir))
    }

    @Test
    fun `a phone that is not listening rests, whatever the snapshot remembers`() {
        assertEquals(WidgetReading.Resting, reading(hasStation = true, playback = WidgetPlayback.STOPPED, snapshot = onAir))
    }

    @Test
    fun `a record is its title over its artist`() {
        assertEquals(
            WidgetReading.Record("A Forest", "The Cure"),
            reading(hasStation = true, playback = WidgetPlayback.PLAYING, snapshot = onAir),
        )
    }

    @Test
    fun `a break is whoever is talking over the break's own label`() {
        val snapshot = onAir.copy(kind = NowPlayingTrackKind.BREAK, title = "Station ident", artist = null, host = "Cass")
        assertEquals(
            WidgetReading.Break(host = "Cass", label = "Station ident"),
            reading(hasStation = true, playback = WidgetPlayback.PLAYING, snapshot = snapshot),
        )
    }

    @Test
    fun `a break the station named nobody for still says somebody is talking`() {
        val snapshot = onAir.copy(kind = NowPlayingTrackKind.BREAK, title = "Station ident", host = null)
        assertEquals(
            WidgetReading.Break(host = null, label = "Station ident"),
            reading(hasStation = true, playback = WidgetPlayback.PLAYING, snapshot = snapshot),
        )
    }

    @Test
    fun `asking for audio while the station is not airing is warming up, never off air`() {
        val snapshot = onAir.copy(onAir = false, title = null, artist = null)
        assertEquals(WidgetReading.WarmingUp, reading(hasStation = true, playback = WidgetPlayback.WARMING_UP, snapshot = snapshot))
        assertEquals(WidgetReading.WarmingUp, reading(hasStation = true, playback = WidgetPlayback.PLAYING, snapshot = snapshot))
    }

    @Test
    fun `on air with no title is warming up rather than a record that is not there`() {
        assertEquals(
            WidgetReading.WarmingUp,
            reading(hasStation = true, playback = WidgetPlayback.PLAYING, snapshot = onAir.copy(title = "  ")),
        )
    }

    @Test
    fun `a station that stopped answering says so, and keeps what it last said`() {
        assertEquals(
            WidgetReading.Unreachable,
            reading(hasStation = true, playback = WidgetPlayback.PLAYING, snapshot = onAir.copy(reachable = false)),
        )
    }

    @Test
    fun `the button follows what was asked for, not what is coming out yet`() {
        assertEquals(WidgetPlayback.STOPPED, widgetPlayback(requested = false, playing = false))
        assertEquals(WidgetPlayback.WARMING_UP, widgetPlayback(requested = true, playing = false))
        assertEquals(WidgetPlayback.PLAYING, widgetPlayback(requested = true, playing = true))
        // A player still draining its buffer after Stop was pressed. The listener asked for it to
        // stop, so every surface says stopped at once rather than a second later.
        assertEquals(WidgetPlayback.STOPPED, widgetPlayback(requested = false, playing = true))
    }
}
