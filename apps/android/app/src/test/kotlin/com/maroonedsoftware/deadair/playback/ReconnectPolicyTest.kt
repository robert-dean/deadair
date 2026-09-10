package com.maroonedsoftware.deadair.playback

import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The reconnect decision, on virtual time.
 *
 * `schedule` runs on the test scheduler rather than a `Handler`, which is what lets this be a
 * plain JVM test: a real `Handler` needs a Looper this class never touches.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ReconnectPolicyTest {
    // The public 3-arg constructor stamps the exception with `Clock.DEFAULT.elapsedRealtime()`,
    // which reaches `android.os.SystemClock` and throws "not mocked" in a plain JVM test. The
    // protected 4-arg constructor takes the timestamp explicitly instead, so an anonymous subclass
    // through it never touches the clock.
    private fun error() = object : PlaybackException("boom", null, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, 0L) {}

    private fun TestScope.policy(
        wantsPlay: () -> Boolean,
        reconnect: () -> Unit = {},
        stop: () -> Unit = {},
        backoff: Backoff = Backoff(),
    ) = ReconnectPolicy(
        backoff = backoff,
        schedule = { ms, run ->
            val job = backgroundScope.launch { delay(ms); run() }
            { job.cancel() }
        },
        wantsPlay = wantsPlay,
        reconnect = reconnect,
        stop = stop,
    )

    @Test
    fun `retries a second after an error`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        advanceTimeBy(999)
        assertEquals(0, reconnects)

        advanceTimeBy(2)
        assertEquals(1, reconnects)
    }

    @Test
    fun `doubles the wait on repeated errors`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(1, reconnects)

        // A retry that itself fails errors again; nothing here calls reconnect() for it, so the
        // test does that on its behalf, exactly as `PlaybackConductor`'s wiring would.
        policy.onPlayerError(error())
        advanceTimeBy(1_999)
        assertEquals(1, reconnects)
        advanceTimeBy(2)
        assertEquals(2, reconnects)

        policy.onPlayerError(error())
        advanceTimeBy(3_999)
        assertEquals(2, reconnects)
        advanceTimeBy(2)
        assertEquals(3, reconnects)
    }

    @Test
    fun `gives up once the backoff is exhausted`() = runTest {
        var reconnects = 0
        // Two 1s waits exhaust a 2s budget, so the third error should schedule nothing.
        val backoff = Backoff(firstMs = 1_000, ceilingMs = 1_000, giveUpAfterMs = 2_000)
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 }, backoff = backoff)

        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(1, reconnects)

        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(2, reconnects)

        policy.onPlayerError(error())
        advanceTimeBy(60_000)
        assertEquals(2, reconnects)
    }

    @Test
    fun `no retry for a stream the listener stopped, at error time`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { false }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        advanceTimeBy(60_000)

        assertEquals(0, reconnects)
    }

    @Test
    fun `no retry for a stream the listener stopped, at fire time`() = runTest {
        var reconnects = 0
        var wantsPlay = true
        val policy = policy(wantsPlay = { wantsPlay }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        wantsPlay = false
        advanceTimeBy(1_001)

        assertEquals(0, reconnects)
    }

    @Test
    fun `forgets the backoff once playing`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(1, reconnects)

        policy.onPlayerError(error())
        advanceTimeBy(2_001)
        assertEquals(2, reconnects)

        policy.onPlaybackStateChanged(Player.STATE_READY)

        policy.onPlayerError(error())
        advanceTimeBy(999)
        assertEquals(2, reconnects)
        advanceTimeBy(2)
        assertEquals(3, reconnects)
    }

    @Test
    fun `drops a pending retry when the stream returns by itself`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        policy.onPlaybackStateChanged(Player.STATE_READY)
        advanceTimeBy(60_000)

        assertEquals(0, reconnects)
    }

    @Test
    fun `ENDED is a failure`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlaybackStateChanged(Player.STATE_ENDED)
        advanceTimeBy(1_001)

        assertEquals(1, reconnects)
    }

    @Test
    fun `playWhenReady false cancels the pending retry`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        policy.onPlayWhenReadyChanged(false, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
        advanceTimeBy(60_000)

        assertEquals(0, reconnects)
    }

    @Test
    fun `one retry is pending across a burst of errors`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        // Three errors with no time between them: each cancels the last one's wait rather than
        // stacking a second timer beside it, so only the LAST one's wait ever fires: the default
        // backoff's third wait, 4s, rather than the first error's 1s.
        policy.onPlayerError(error())
        policy.onPlayerError(error())
        policy.onPlayerError(error())

        advanceTimeBy(3_999)
        assertEquals(0, reconnects)
        advanceTimeBy(2)
        assertEquals(1, reconnects)
    }

    @Test
    fun `cancel drops the pending retry`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        policy.cancel()
        advanceTimeBy(60_000)

        assertEquals(0, reconnects)
    }
}
