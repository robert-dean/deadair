package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The push-timing decision, on virtual time.
 *
 * `schedule` runs on the test scheduler rather than a `Handler`, which is what lets this be a
 * plain JVM test, exactly as `ReconnectPolicyTest` does for its sibling.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NowPlayingGateTest {
    private fun reading(startedAt: Long) =
        NowPlaying(
            station = "Test FM",
            onAir = true,
            listeners = 1,
            mounts = emptyList(),
            track = NowPlayingTrack(title = "A Song", artist = "Someone", startedAt = startedAt),
        )

    private fun TestScope.gate(push: (NowPlaying?) -> Unit) =
        NowPlayingGate(
            schedule = { ms, run ->
                val job = backgroundScope.launch { delay(ms); run() }
                { job.cancel() }
            },
            push = push,
        )

    @Test
    fun `first reading pushes immediately`() = runTest {
        var pushed: NowPlaying? = null
        var pushes = 0
        val gate = gate { pushed = it; pushes += 1 }

        val first = reading(startedAt = 1_000)
        gate.onPoll(first, bufferedMs = 5_000)

        assertEquals(1, pushes)
        assertEquals(first, pushed)
    }

    @Test
    fun `an unmoved reading with nothing shown different is not pushed again`() = runTest {
        var pushes = 0
        val gate = gate { pushes += 1 }

        gate.onPoll(reading(startedAt = 1_000), bufferedMs = 5_000)
        assertEquals(1, pushes)

        // Same track, a different reading instance whose only change is a field the lock screen
        // does not show: pushing this is the churn `replaceMediaItem` every three seconds that the
        // old `pushedFor` guard, comparing only `startedAt`, did not catch.
        gate.onPoll(reading(startedAt = 1_000).copy(listeners = 99), bufferedMs = 5_000)
        assertEquals(1, pushes)
    }

    @Test
    fun `an unmoved reading pushes again when something shown changes`() = runTest {
        var pushed: NowPlaying? = null
        var pushes = 0
        val gate = gate { pushed = it; pushes += 1 }

        gate.onPoll(reading(startedAt = 1_000), bufferedMs = 5_000)
        assertEquals(1, pushes)

        val corrected = reading(startedAt = 1_000).let { it.copy(track = it.track!!.copy(title = "A Corrected Title")) }
        gate.onPoll(corrected, bufferedMs = 5_000)
        assertEquals(2, pushes)
        assertEquals(corrected, pushed)
    }

    @Test
    fun `a moved startedAt is held until the buffered duration elapses`() = runTest {
        var pushed: NowPlaying? = null
        var pushes = 0
        val gate = gate { pushed = it; pushes += 1 }

        gate.onPoll(reading(startedAt = 1_000), bufferedMs = 5_000)
        assertEquals(1, pushes)

        val moved = reading(startedAt = 2_000)
        gate.onPoll(moved, bufferedMs = 4_000)
        assertEquals(1, pushes)

        advanceTimeBy(3_999)
        assertEquals(1, pushes)

        advanceTimeBy(2)
        assertEquals(2, pushes)
        assertEquals(moved, pushed)
    }

    @Test
    fun `re-polling the same moved track while held does not restart the wait`() = runTest {
        var pushed: NowPlaying? = null
        var pushes = 0
        val gate = gate { pushed = it; pushes += 1 }

        gate.onPoll(reading(startedAt = 1_000), bufferedMs = 5_000)
        assertEquals(1, pushes)

        val moved = reading(startedAt = 2_000)
        gate.onPoll(moved, bufferedMs = 3_000)
        assertEquals(1, pushes)

        // Still the same held track, seen again on the next three-second poll before its release
        // fires: routine once the buffer outlasts the poll interval, which HLS always does since it
        // carries no ICY of its own. This refreshes what will eventually be pushed without pushing
        // the release itself any further out; cancelling and rescheduling here, as an ordinary moved
        // track would, is exactly what let a long-enough buffer defer the release forever.
        advanceTimeBy(1_000)
        val refreshed = moved.copy(listeners = 42)
        gate.onPoll(refreshed, bufferedMs = 3_000)
        assertEquals(1, pushes)

        advanceTimeBy(1_999)
        assertEquals(1, pushes)
        advanceTimeBy(2)
        assertEquals(2, pushes)
        assertEquals(refreshed, pushed)
    }

    @Test
    fun `an ICY change releases the held reading early`() = runTest {
        var pushed: NowPlaying? = null
        var pushes = 0
        val gate = gate { pushed = it; pushes += 1 }

        gate.onPoll(reading(startedAt = 1_000), bufferedMs = 5_000)
        assertEquals(1, pushes)

        val moved = reading(startedAt = 2_000)
        gate.onPoll(moved, bufferedMs = 30_000)
        assertEquals(1, pushes)

        gate.onIcyTitle("A Song - Someone")
        assertEquals(2, pushes)
        assertEquals(moved, pushed)

        // The timer that would have released it later is gone, so nothing fires again from it.
        advanceTimeBy(60_000)
        assertEquals(2, pushes)
    }

    @Test
    fun `an ICY change with no held reading pushes the latest`() = runTest {
        var pushed: NowPlaying? = null
        var pushes = 0
        val gate = gate { pushed = it; pushes += 1 }

        val first = reading(startedAt = 1_000)
        gate.onPoll(first, bufferedMs = 5_000)
        assertEquals(1, pushes)

        gate.onIcyTitle("A Song - Someone")
        assertEquals(2, pushes)
        assertEquals(first, pushed)
    }

    @Test
    fun `a repeated ICY title is not a change`() = runTest {
        var pushes = 0
        val gate = gate { pushes += 1 }

        gate.onPoll(reading(startedAt = 1_000), bufferedMs = 5_000)
        assertEquals(1, pushes)

        gate.onIcyTitle("A Song - Someone")
        assertEquals(2, pushes)

        gate.onIcyTitle("A Song - Someone")
        assertEquals(2, pushes)
    }

    @Test
    fun `an ICY change before any poll reading does nothing`() = runTest {
        var pushes = 0
        val gate = gate { pushes += 1 }

        gate.onIcyTitle("A Song - Someone")

        assertEquals(0, pushes)
    }

    @Test
    fun `cancel drops a pending release`() = runTest {
        var pushes = 0
        val gate = gate { pushes += 1 }

        gate.onPoll(reading(startedAt = 1_000), bufferedMs = 5_000)
        assertEquals(1, pushes)

        gate.onPoll(reading(startedAt = 2_000), bufferedMs = 4_000)
        gate.cancel()

        advanceTimeBy(60_000)
        assertEquals(1, pushes)
    }

    @Test
    fun `an off-air reading with no track pushes once, and a repeat of it does not`() = runTest {
        var pushed: NowPlaying? = null
        var pushes = 0
        val gate = gate { pushed = it; pushes += 1 }

        val offAir = NowPlaying(station = "Test FM", onAir = false, listeners = 0, mounts = emptyList(), track = null)
        gate.onPoll(offAir, bufferedMs = 5_000)
        assertEquals(1, pushes)
        assertEquals(offAir, pushed)
        assertNull(pushed?.track)

        // Still off air, nothing shown different: a no-op rather than a second push.
        gate.onPoll(offAir, bufferedMs = 5_000)
        assertEquals(1, pushes)
    }
}
