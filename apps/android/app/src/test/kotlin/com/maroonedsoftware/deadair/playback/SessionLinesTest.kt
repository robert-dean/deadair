package com.maroonedsoftware.deadair.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which play, stop and item lines the playback journal gets. */
class SessionLinesTest {
    private val lines = SessionLines()

    @Test
    fun `play names nothing, and the item is written when it is set`() {
        // The item held at the press was the last format played; the chosen one arrives after.
        assertEquals("play", lines.onPlayWhenReady(playing = true, reason = "listener"))
        assertEquals("item uri=https://radio.example/live.m3u8", lines.onItem("https://radio.example/live.m3u8"))
    }

    @Test
    fun `only the first stop of a session is written, because it is the one that says why`() {
        lines.onPlayWhenReady(playing = true, reason = "listener")

        assertEquals("stop reason=headphones-unplugged", lines.onPlayWhenReady(playing = false, reason = "headphones-unplugged"))
        assertNull(lines.onPlayWhenReady(playing = false, reason = "listener"))
    }

    @Test
    fun `the next play is written, and its stop`() {
        lines.onPlayWhenReady(playing = true, reason = "listener")
        lines.onPlayWhenReady(playing = false, reason = "listener")

        assertEquals("play", lines.onPlayWhenReady(playing = true, reason = "listener"))
        assertEquals("stop reason=audio-focus", lines.onPlayWhenReady(playing = false, reason = "audio-focus"))
    }

    @Test
    fun `nothing is written for a stop before any play`() {
        assertNull(lines.onPlayWhenReady(playing = false, reason = "listener"))
    }

    @Test
    fun `the same item set again by a restart is not written twice, and a new one is`() {
        lines.onItem("https://radio.example/live.m3u8")

        assertNull(lines.onItem("https://radio.example/live.m3u8"))
        assertEquals("item uri=https://radio.example/live.opus", lines.onItem("https://radio.example/live.opus"))
        assertNull(lines.onItem(null))
    }
}
