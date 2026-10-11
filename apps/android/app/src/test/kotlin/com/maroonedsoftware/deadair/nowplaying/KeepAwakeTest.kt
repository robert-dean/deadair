package com.maroonedsoftware.deadair.nowplaying

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When Now playing holds the screen on. */
class KeepAwakeTest {
    @Test
    fun `never holds it, whatever else is true`() {
        assertFalse(keepAwake(KeepAwake.NEVER, charging = true, playing = true, inFront = true))
    }

    @Test
    fun `always holds it on the battery`() {
        assertTrue(keepAwake(KeepAwake.ALWAYS, charging = false, playing = true, inFront = true))
    }

    @Test
    fun `while charging holds it on power`() {
        assertTrue(keepAwake(KeepAwake.WHILE_CHARGING, charging = true, playing = true, inFront = true))
    }

    @Test
    fun `while charging lets it sleep on the battery`() {
        assertFalse(keepAwake(KeepAwake.WHILE_CHARGING, charging = false, playing = true, inFront = true))
    }

    @Test
    fun `nothing playing on this phone lets it sleep, even set to always`() {
        assertFalse(keepAwake(KeepAwake.ALWAYS, charging = true, playing = false, inFront = true))
    }

    @Test
    fun `Now playing behind something else lets it sleep, even set to always`() {
        assertFalse(keepAwake(KeepAwake.ALWAYS, charging = true, playing = true, inFront = false))
    }
}
