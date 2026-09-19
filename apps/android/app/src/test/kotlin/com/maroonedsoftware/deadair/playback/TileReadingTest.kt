package com.maroonedsoftware.deadair.playback

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The tile follows what was asked for, as the app's Play button does, so the tile and the button
 * never disagree; and the warm-up is its own state, because it is not a fault and not "off".
 */
class TileReadingTest {
    @Test
    fun `no station is nothing to play, whatever the player says`() {
        assertEquals(TileReading.NO_STATION, tileReading(hasStation = false, PlayerUiState(requested = true, playing = true)))
    }

    @Test
    fun `before the controller binds, the station reads as off`() {
        assertEquals(TileReading.STOPPED, tileReading(hasStation = true, PlayerUiState(connected = false)))
    }

    @Test
    fun `asked for and silent is warming up`() {
        assertEquals(TileReading.WARMING_UP, tileReading(hasStation = true, PlayerUiState(requested = true, buffering = true)))
    }

    @Test
    fun `asked for and sounding is on`() {
        assertEquals(TileReading.PLAYING, tileReading(hasStation = true, PlayerUiState(requested = true, playing = true)))
    }

    @Test
    fun `sound still draining after a stop reads as off`() {
        assertEquals(TileReading.STOPPED, tileReading(hasStation = true, PlayerUiState(requested = false, playing = true)))
    }
}
