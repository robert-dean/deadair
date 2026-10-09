package com.maroonedsoftware.deadair.playback

import android.os.Bundle
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
    // protected 5-arg constructor takes the extras and the timestamp explicitly instead, so an
    // anonymous subclass through it never touches the clock. It only stores the `Bundle`, so the
    // stub jar's `Bundle.EMPTY` is enough.
    private fun error() = object : PlaybackException("boom", null, PlaybackException.ERROR_CODE_IO_UNSPECIFIED, Bundle.EMPTY, 0L) {}

    private fun TestScope.policy(
        wantsPlay: () -> Boolean,
        reconnect: () -> Unit = {},
        stop: () -> Unit = {},
        backoff: Backoff = Backoff(),
        offlineLimitMs: Long = 15 * 60_000L,
        restart: () -> Unit = {},
    ) = ReconnectPolicy(
        backoff = backoff,
        // `.let` rather than a `{ job.cancel() }` on a line of its own, which Kotlin reads as a
        // trailing lambda passed to the `launch` above it.
        schedule = { ms, run -> backgroundScope.launch { delay(ms); run() }.let { job -> { job.cancel() } } },
        wantsPlay = wantsPlay,
        reconnect = reconnect,
        stop = stop,
        restart = restart,
        offlineLimitMs = offlineLimitMs,
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
    fun `gives up once the backoff is exhausted, and stops`() = runTest {
        var reconnects = 0
        var stops = 0
        // Two 1s waits exhaust a 2s budget, so the third error should schedule nothing.
        val backoff = Backoff(firstMs = 1_000, ceilingMs = 1_000, giveUpAfterMs = 2_000)
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 }, stop = { stops += 1 }, backoff = backoff)

        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(1, reconnects)

        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(2, reconnects)

        policy.onPlayerError(error())
        advanceTimeBy(60_000)
        assertEquals(2, reconnects)
        // Standing down is not enough: a player still wanting to play is a poll still asking the
        // station what is on, every three seconds, for a stream this has given up on.
        assertEquals(1, stops)
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

    @Test
    fun `audio focus loss stops`() = runTest {
        var stops = 0
        val policy = policy(wantsPlay = { true }, stop = { stops += 1 })

        policy.onPlayWhenReadyChanged(false, Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)

        assertEquals(1, stops)
    }

    @Test
    fun `audio becoming noisy stops`() = runTest {
        var stops = 0
        val policy = policy(wantsPlay = { true }, stop = { stops += 1 })

        policy.onPlayWhenReadyChanged(false, Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY)

        assertEquals(1, stops)
    }

    @Test
    fun `a user's own pause does not stop`() = runTest {
        var stops = 0
        val policy = policy(wantsPlay = { true }, stop = { stops += 1 })

        policy.onPlayWhenReadyChanged(false, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)

        assertEquals(0, stops)
    }

    @Test
    fun `becoming ready again does not stop`() = runTest {
        var stops = 0
        val policy = policy(wantsPlay = { true }, stop = { stops += 1 })

        policy.onPlayWhenReadyChanged(true, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)

        assertEquals(0, stops)
    }

    @Test
    fun `suppression stops`() = runTest {
        var stops = 0
        val policy = policy(wantsPlay = { true }, stop = { stops += 1 })

        policy.onPlaybackSuppressionReasonChanged(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS)

        assertEquals(1, stops)
    }

    @Test
    fun `suppression clearing back to NONE does not stop`() = runTest {
        var stops = 0
        val policy = policy(wantsPlay = { true }, stop = { stops += 1 })

        policy.onPlaybackSuppressionReasonChanged(Player.PLAYBACK_SUPPRESSION_REASON_NONE)

        assertEquals(0, stops)
    }

    @Test
    fun `with no network a drop waits for one rather than retrying`() = runTest {
        var reconnects = 0
        var stops = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 }, stop = { stops += 1 })

        policy.onNetwork(null)
        // Errors one after another, as a player retrying nothing would make them: none is retried
        // and none spends the budget, so ten minutes of them stops nothing.
        repeat(20) {
            policy.onPlayerError(error())
            advanceTimeBy(30_000)
        }

        assertEquals(0, reconnects)
        assertEquals(0, stops)
    }

    @Test
    fun `the network coming back retries at once`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onNetwork(null)
        policy.onPlayerError(error())
        advanceTimeBy(60_000)
        policy.onNetwork(WIFI)

        assertEquals(1, reconnects)
    }

    @Test
    fun `the network coming back starts the backoff again from a second`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        // Most of the budget spent before the network went.
        repeat(5) {
            policy.onPlayerError(error())
            advanceTimeBy(30_001)
        }
        assertEquals(5, reconnects)

        policy.onNetwork(null)
        policy.onPlayerError(error())
        policy.onNetwork(WIFI)
        assertEquals(6, reconnects)

        // The attempt made on the network's return failed too; it waits a second, not thirty.
        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(7, reconnects)
    }

    @Test
    fun `losing the network holds a retry that was already scheduled`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        policy.onNetwork(null)
        advanceTimeBy(60_000)
        assertEquals(0, reconnects)

        policy.onNetwork(WIFI)
        assertEquals(1, reconnects)
    }

    @Test
    fun `losing the network while playing does nothing until the player fails`() = runTest {
        var reconnects = 0
        var stops = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 }, stop = { stops += 1 })

        // A handover with audio still in the buffer, and the new network up before it ran out.
        policy.onNetwork(null)
        policy.onNetwork(WIFI)
        advanceTimeBy(60_000)

        assertEquals(0, reconnects)
        assertEquals(0, stops)
    }

    @Test
    fun `a retry that already fired is not held when the network goes`() = runTest {
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 })

        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(1, reconnects)

        // The attempt is connecting when the network goes, and connects anyway on the next one:
        // nothing failed, so the network's return has nothing to retry.
        policy.onNetwork(null)
        policy.onNetwork(WIFI)
        assertEquals(1, reconnects)
    }

    @Test
    fun `waiting for the network ends in a stop after its own limit`() = runTest {
        var stops = 0
        val policy = policy(wantsPlay = { true }, stop = { stops += 1 }, offlineLimitMs = 60_000)

        policy.onNetwork(null)
        policy.onPlayerError(error())
        advanceTimeBy(30_000)
        // A second error while already waiting does not start the limit again.
        policy.onPlayerError(error())
        advanceTimeBy(29_999)
        assertEquals(0, stops)

        advanceTimeBy(2)
        assertEquals(1, stops)
    }

    @Test
    fun `the listener stopping ends the wait for the network`() = runTest {
        var reconnects = 0
        var stops = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 }, stop = { stops += 1 }, offlineLimitMs = 60_000)

        policy.onNetwork(null)
        policy.onPlayerError(error())
        policy.onPlayWhenReadyChanged(false, Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST)
        advanceTimeBy(120_000)
        policy.onNetwork(WIFI)

        assertEquals(0, reconnects)
        assertEquals(0, stops)
    }

    @Test
    fun `a move to another network restarts a held connection at once`() = runTest {
        var restarts = 0
        var reconnects = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 }, restart = { restarts += 1 })

        policy.onNetwork(WIFI)
        // Wifi fading out: mobile data becomes the default while the socket is still on wifi and
        // the player has not noticed anything yet.
        policy.onNetwork(CELL)

        assertEquals(1, restarts)
        assertEquals(0, reconnects)
    }

    @Test
    fun `a move through a spell with no network is still a move`() = runTest {
        var restarts = 0
        val policy = policy(wantsPlay = { true }, restart = { restarts += 1 })

        policy.onNetwork(WIFI)
        policy.onNetwork(null)
        advanceTimeBy(5_000)
        policy.onNetwork(CELL)

        assertEquals(1, restarts)
    }

    @Test
    fun `the same network coming back is not a move`() = runTest {
        var restarts = 0
        val policy = policy(wantsPlay = { true }, restart = { restarts += 1 })

        policy.onNetwork(WIFI)
        policy.onNetwork(null)
        policy.onNetwork(WIFI)

        assertEquals(0, restarts)
    }

    @Test
    fun `the first network heard of is not a move`() = runTest {
        var restarts = 0
        val policy = policy(wantsPlay = { true }, restart = { restarts += 1 })

        policy.onNetwork(CELL)

        assertEquals(0, restarts)
    }

    @Test
    fun `a move makes a scheduled retry now, from a fresh backoff`() = runTest {
        var reconnects = 0
        var restarts = 0
        val policy = policy(wantsPlay = { true }, reconnect = { reconnects += 1 }, restart = { restarts += 1 })

        policy.onNetwork(WIFI)
        repeat(4) {
            policy.onPlayerError(error())
            advanceTimeBy(30_000)
        }
        assertEquals(4, reconnects)
        // The fifth failure's retry is sixteen seconds out when mobile data takes over.
        policy.onPlayerError(error())
        policy.onNetwork(CELL)
        assertEquals(5, reconnects)
        assertEquals(0, restarts)

        // Nothing left over from the old wait, and the next failure waits a second.
        advanceTimeBy(20_000)
        assertEquals(5, reconnects)
        policy.onPlayerError(error())
        advanceTimeBy(1_001)
        assertEquals(6, reconnects)
    }

    @Test
    fun `a move with nobody listening does nothing`() = runTest {
        var restarts = 0
        var reconnects = 0
        val policy = policy(wantsPlay = { false }, reconnect = { reconnects += 1 }, restart = { restarts += 1 })

        policy.onNetwork(WIFI)
        policy.onNetwork(CELL)

        assertEquals(0, restarts)
        assertEquals(0, reconnects)
    }

    private companion object {
        const val WIFI = 100L
        const val CELL = 200L
    }
}
