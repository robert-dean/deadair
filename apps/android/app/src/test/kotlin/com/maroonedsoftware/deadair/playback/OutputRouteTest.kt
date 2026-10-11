package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.playback.OutputRoute.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which outputs Now playing names under the controls. */
class OutputRouteTest {
    @Test
    fun `names a Bluetooth device while playing`() {
        assertEquals("Earbuds", playingOn(OutputRoute(Kind.BLUETOOTH, "Earbuds"), playing = true))
    }

    @Test
    fun `names a speaker on the network while playing`() {
        assertEquals("Kitchen", playingOn(OutputRoute(Kind.REMOTE, "Kitchen"), playing = true))
    }

    @Test
    fun `says nothing for the phone or what is plugged into it`() {
        assertNull(playingOn(OutputRoute(Kind.PHONE, "Phone"), playing = true))
        assertNull(playingOn(OutputRoute(Kind.WIRED, "Wired headphones"), playing = true))
        assertNull(playingOn(OutputRoute(Kind.OTHER, "Something"), playing = true))
    }

    @Test
    fun `says nothing while the phone is not playing`() {
        assertNull(playingOn(OutputRoute(Kind.BLUETOOTH, "Earbuds"), playing = false))
    }

    @Test
    fun `says nothing without a route or a name`() {
        assertNull(playingOn(null, playing = true))
        assertNull(playingOn(OutputRoute(Kind.BLUETOOTH, " "), playing = true))
    }
}
