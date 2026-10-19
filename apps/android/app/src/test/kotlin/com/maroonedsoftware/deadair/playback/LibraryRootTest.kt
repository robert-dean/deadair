package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.station.StationUrl
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The library root is answered at once from what the service already holds, because a legacy
 * browser asking for it blocks the main thread until it has an answer. Never refused: a refused
 * root is a car saying the app could not load.
 */
class LibraryRootTest {
    private val station = StationUrl.parse("https://radio.example").getOrThrow()

    @Test
    fun `a browser that connects before the settings are read is offered the root under the app's name`() {
        assertEquals("deadair", libraryRootTitle(KeptStation.Unread, appName = "deadair"))
    }

    @Test
    fun `no station kept still offers the root, under the app's name`() {
        assertEquals("deadair", libraryRootTitle(KeptStation.None, appName = "deadair"))
    }

    @Test
    fun `a kept station titles the root with its name`() {
        assertEquals("Dead Air FM", libraryRootTitle(KeptStation.Named("Dead Air FM"), appName = "deadair"))
    }

    @Test
    fun `settings with no station are none`() {
        assertEquals(KeptStation.None, KeptStation.of(ListenerSettings()))
    }

    @Test
    fun `the name the station gave is kept`() {
        assertEquals(KeptStation.Named("Dead Air FM"), KeptStation.of(ListenerSettings(station = station, stationName = "Dead Air FM")))
    }

    @Test
    fun `a station that never gave a name is its address`() {
        assertEquals(KeptStation.Named(station.origin), KeptStation.of(ListenerSettings(station = station)))
    }
}
