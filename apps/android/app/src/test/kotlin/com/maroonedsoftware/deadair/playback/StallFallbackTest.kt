package com.maroonedsoftware.deadair.playback

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** Moving a stream stalled on wifi to the cellular network standing by, on virtual time. */
@OptIn(ExperimentalCoroutinesApi::class)
class StallFallbackTest {
    private val calls = mutableListOf<String>()
    private val notes = mutableListOf<String>()

    private fun TestScope.fallback() =
        StallFallback(
            schedule = { ms, run -> backgroundScope.launch { delay(ms); run() }.let { job -> { job.cancel() } } },
            request = { calls += "request" },
            release = { calls += "release" },
            note = { notes += it },
        )

    /** A playing stream on wifi, with cellular standing by: the morning of 2026-10-20 at 10:35. */
    private fun TestScope.onWifiWithCellular(): StallFallback =
        fallback().apply {
            onDefault(WIFI, "wifi")
            onStandby(CELL)
        }

    @Test
    fun `a stall of four seconds on wifi asks for cellular`() = runTest {
        val fallback = onWifiWithCellular()

        fallback.onStall()
        advanceTimeBy(3_999)
        assertEquals(emptyList<String>(), calls)

        advanceTimeBy(2)
        assertEquals(listOf("request"), calls)
        assertEquals(listOf("fallback: stalled 4000ms on wifi, requesting cellular handle=$CELL"), notes)
    }

    @Test
    fun `an ordinary stall that recovers asks for nothing`() = runTest {
        // 274ms and 605ms, the two that morning on a good network.
        val fallback = onWifiWithCellular()

        fallback.onStall()
        advanceTimeBy(605)
        fallback.onResumed()
        advanceTimeBy(10_000)

        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun `a stall on cellular is not the wifi's fault and asks for nothing`() = runTest {
        val fallback = fallback()
        fallback.onDefault(CELL, "cellular")
        fallback.onStandby(CELL)

        fallback.onStall()
        advanceTimeBy(10_000)

        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun `with no cellular standing by it says so and asks for nothing`() = runTest {
        val fallback = fallback()
        fallback.onDefault(WIFI, "wifi")

        fallback.onStall()
        advanceTimeBy(4_001)

        assertEquals(emptyList<String>(), calls)
        assertEquals(listOf("fallback: stalled 4000ms on wifi, no cellular standing by"), notes)
    }

    @Test
    fun `the wifi going while pinned keeps the pin, and cellular becoming the default releases it`() = runTest {
        // The rest of that morning: the wifi vanished nineteen seconds in, and Android made the
        // cellular network the default. The stream should already be there, and stay.
        val fallback = onWifiWithCellular()
        fallback.onStall()
        advanceTimeBy(4_001)
        fallback.onPinned(CELL)

        fallback.onDefault(null, null)
        assertEquals(listOf("request"), calls)

        fallback.onDefault(CELL, "cellular")
        assertEquals(listOf("request", "release"), calls)
        assertEquals("fallback released: default is now cellular handle=$CELL", notes.last())
    }

    @Test
    fun `the same wifi coming back after a blip does not release the pin, a new wifi does`() = runTest {
        val fallback = onWifiWithCellular()
        fallback.onStall()
        advanceTimeBy(4_001)

        fallback.onDefault(null, null)
        fallback.onDefault(WIFI, "wifi")
        assertEquals(listOf("request"), calls)

        fallback.onDefault(HOME, "wifi")
        assertEquals(listOf("request", "release"), calls)
    }

    @Test
    fun `stopping releases the pin and cancels a stall still being timed`() = runTest {
        val pinned = onWifiWithCellular()
        pinned.onStall()
        advanceTimeBy(4_001)
        pinned.onStopped()
        assertEquals(listOf("request", "release"), calls)
        assertEquals("fallback released: stopped", notes.last())

        calls.clear()
        val timing = onWifiWithCellular()
        timing.onStall()
        advanceTimeBy(2_000)
        timing.onStopped()
        advanceTimeBy(10_000)
        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun `losing the cellular network or never getting it releases`() = runTest {
        val lost = onWifiWithCellular()
        lost.onStall()
        advanceTimeBy(4_001)
        lost.onCellularLost()
        assertEquals("fallback released: cellular lost", notes.last())

        val unanswered = onWifiWithCellular()
        unanswered.onStall()
        advanceTimeBy(4_001)
        unanswered.onUnanswered()
        assertEquals("fallback released: cellular request unanswered", notes.last())

        assertEquals(listOf("request", "release", "request", "release"), calls)
    }

    @Test
    fun `asks once, however long or often it stalls while pinned`() = runTest {
        val fallback = onWifiWithCellular()
        fallback.onStall()
        advanceTimeBy(4_001)

        fallback.onResumed()
        fallback.onStall()
        advanceTimeBy(10_000)

        assertEquals(listOf("request"), calls)
    }

    @Test
    fun `the wifi going while a stall is timed cancels it, because Android has moved on`() = runTest {
        val fallback = onWifiWithCellular()
        fallback.onStall()
        advanceTimeBy(2_000)

        fallback.onDefault(null, null)
        advanceTimeBy(10_000)

        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun `nothing to release is not released`() = runTest {
        val fallback = onWifiWithCellular()

        fallback.onStopped()
        fallback.onCellularLost()
        fallback.onDefault(HOME, "wifi")

        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun `a stream stuck playing on wifi asks for cellular at once`() = runTest {
        // 2026-10-21 17:28:54: stuck, with the wifi lost ten seconds later and no stall at all.
        val fallback = onWifiWithCellular()

        fallback.onFailure(StallFallback.Failure.Stuck)

        assertEquals(listOf("request"), calls)
        assertEquals(listOf("fallback: stuck playing on wifi, requesting cellular handle=$CELL"), notes)
    }

    @Test
    fun `falling behind the live window once leaves it to the jump to the live edge`() = runTest {
        val fallback = onWifiWithCellular()

        fallback.onFailure(StallFallback.Failure.BehindLive)
        advanceTimeBy(60_000)

        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun `falling behind twice within thirty seconds asks for cellular, and after thirty does not`() = runTest {
        val twice = onWifiWithCellular()
        twice.onFailure(StallFallback.Failure.BehindLive)
        advanceTimeBy(20_000)
        twice.onFailure(StallFallback.Failure.BehindLive)
        assertEquals(listOf("request"), calls)
        assertEquals("fallback: fell behind the live window twice on wifi, requesting cellular handle=$CELL", notes.last())

        calls.clear()
        val apart = onWifiWithCellular()
        apart.onFailure(StallFallback.Failure.BehindLive)
        advanceTimeBy(30_001)
        apart.onFailure(StallFallback.Failure.BehindLive)
        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun `a failure on cellular, or already pinned, asks for nothing more`() = runTest {
        val onCellular = fallback()
        onCellular.onDefault(CELL, "cellular")
        onCellular.onStandby(CELL)
        onCellular.onFailure(StallFallback.Failure.Stuck)
        assertEquals(emptyList<String>(), calls)

        val pinned = onWifiWithCellular()
        pinned.onFailure(StallFallback.Failure.Stuck)
        pinned.onFailure(StallFallback.Failure.Stuck)
        assertEquals(listOf("request"), calls)
    }

    @Test
    fun `a failure with no cellular standing by says so`() = runTest {
        val fallback = fallback()
        fallback.onDefault(WIFI, "wifi")

        fallback.onFailure(StallFallback.Failure.Stuck)

        assertEquals(emptyList<String>(), calls)
        assertEquals(listOf("fallback: stuck playing on wifi, no cellular standing by"), notes)
    }

    @Test
    fun `a failure during a stall being timed moves once, not again when the timer would have fired`() = runTest {
        val fallback = onWifiWithCellular()
        fallback.onStall()
        advanceTimeBy(2_000)

        fallback.onFailure(StallFallback.Failure.Stuck)
        advanceTimeBy(10_000)

        assertEquals(listOf("request"), calls)
    }

    private companion object {
        const val WIFI = 591_816_216_589L
        const val HOME = 596_111_183_885L
        const val CELL = 574_636_347_405L
    }
}
