package com.maroonedsoftware.deadair.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** How long the listener heard nothing, whatever road the audio took back. */
class QuietSpellTest {
    private val quiet = QuietSpell()

    @Test
    fun `a stall is timed to the next ready`() {
        quiet.onStall(1_000)

        assertTrue(quiet.active)
        assertEquals("resumed after 420ms", quiet.onReady(1_420))
        assertFalse(quiet.active)
    }

    @Test
    fun `an error is timed through the retry that follows it`() {
        // The road the old stall timer never measured: error, idle, retry, a fresh start.
        quiet.onError(10_000, wantsPlay = true, isStuck = false)

        assertEquals("resumed after 2400ms", quiet.onReady(12_400))
    }

    @Test
    fun `a stall then an error then a restart on another network is one spell, from the stall`() {
        // 2026-10-21 17:28 on the walk: behind the live window, then a restart when the wifi went.
        quiet.onStall(0)
        quiet.onError(800, wantsPlay = true, isStuck = false)
        quiet.onError(47_500, wantsPlay = true, isStuck = false)

        assertEquals("resumed after 61000ms", quiet.onReady(61_000))
    }

    @Test
    fun `a stuck stream says how long it was stuck before the error`() {
        quiet.onError(20_000, wantsPlay = true, isStuck = true)

        assertEquals("resumed after 1500ms, after 10000ms stuck before the error", quiet.onReady(21_500))
    }

    @Test
    fun `a stop forgets the spell, so the next play is not timed from it`() {
        quiet.onStall(0)
        quiet.onStopped()

        assertFalse(quiet.active)
        assertNull(quiet.onReady(90_000))
    }

    @Test
    fun `an error after the listener stopped starts nothing`() {
        // A retry already in flight when Stop was pressed fails on its own afterwards.
        quiet.onError(5_000, wantsPlay = false, isStuck = false)

        assertNull(quiet.onReady(6_000))
    }

    @Test
    fun `a ready with no silence before it says nothing`() {
        assertNull(quiet.onReady(1_000))
    }

    @Test
    fun `the stuck note belongs to its own spell and not to the next`() {
        quiet.onError(0, wantsPlay = true, isStuck = true)
        quiet.onReady(1_000)

        quiet.onStall(5_000)
        assertEquals("resumed after 300ms", quiet.onReady(5_300))
    }
}
