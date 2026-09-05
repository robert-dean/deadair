package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingMount
import com.maroonedsoftware.deadair.sdk.models.NowPlayingMountFormat
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.station.StationUrl
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * The polling loop, on virtual time.
 *
 * The station is a plain suspend function here rather than an HTTP client, which is what lets the
 * whole of this run on the test scheduler: a real Ktor engine dispatches onto threads virtual time
 * knows nothing about, so a test written against one measures the machine rather than the policy.
 * What the SDK does with a real response is covered in `NowPlayingDecodeTest` and `StationProbeTest`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NowPlayingRepositoryTest {
    private val station = StationUrl.parse("https://radio.example.com").getOrThrow()

    private fun answer(listeners: Long) =
        NowPlaying(
            station = "Static",
            onAir = true,
            listeners = listeners,
            mounts = listOf(NowPlayingMount(NowPlayingMountFormat.MP3, "/live.mp3", 128)),
            track = null,
        )

    /**
     * The repository shares into `backgroundScope`, and so does every collector below.
     *
     * Both loops run forever on purpose — that is what a poll is — and `runTest` waits for
     * anything launched in the test scope itself, so putting either in the foreground scope hangs
     * the test for a minute and then fails on the coroutine rather than on the behaviour.
     */
    private fun TestScope.repository(clock: () -> Long = { 0L }, fetch: suspend (StationUrl) -> NowPlaying) =
        NowPlayingRepository(
            settings = MutableStateFlow(ListenerSettings(station = station)),
            fetch = fetch,
            elapsedMs = clock,
            scope = backgroundScope,
        )

    @Test
    fun `asks again on the poll interval while something is watching`() = runTest {
        var calls = 0
        val repository = repository { calls += 1; answer(calls.toLong()) }

        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { repository.state.collect {} }
        advanceTimeBy(NowPlayingRepository.POLL_MS * 3 + 100)

        // One at subscribe, then one per interval.
        assertEquals(4, calls)
    }

    @Test
    fun `keeps the last good reading when a poll fails`() = runTest {
        var calls = 0
        val repository =
            repository {
                calls += 1
                if (calls == 1) answer(7) else throw IOException("network gone")
            }

        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { repository.state.collect {} }
        advanceTimeBy(NowPlayingRepository.POLL_MS + 100)

        val state = repository.state.value
        assertTrue("expected Unreachable, got $state", state is NowPlayingState.Unreachable)
        // What was showing does not vanish; the screen says it is stale instead.
        assertEquals(7L, (state as NowPlayingState.Unreachable).lastGood?.nowPlaying?.listeners)
    }

    @Test
    fun `backs off rather than hammering a station that is down`() = runTest {
        var calls = 0
        val repository = repository { calls += 1; throw IOException("down") }

        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { repository.state.collect {} }
        // A steady 3s poll would make eleven calls in thirty seconds. Doubling makes far fewer.
        advanceTimeBy(30_000)

        assertTrue("expected backoff to reduce calls, got $calls", calls in 2..6)
    }

    @Test
    fun `recovers its cadence once the station answers again`() = runTest {
        var calls = 0
        var failing = true
        val repository =
            repository {
                calls += 1
                if (failing) throw IOException("down") else answer(1)
            }

        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { repository.state.collect {} }
        advanceTimeBy(30_000)
        val whileDown = calls

        failing = false
        // The backed-off delay already scheduled has to elapse before the station is asked again,
        // so this window covers that wait and then the fast polls that follow it.
        advanceTimeBy(NowPlayingRepository.MAX_POLL_MS + 30_000)

        // Back to the steady interval rather than staying backed off, so a station that comes back
        // is noticed promptly rather than half a minute later every time.
        assertTrue("expected the fast cadence to resume, got ${calls - whileDown} calls", calls - whileDown >= 8)
    }

    @Test
    fun `stamps each reading with the clock, so the playhead can be projected from it`() = runTest {
        val repository = repository(clock = { 4_242L }) { answer(1) }

        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { repository.state.collect {} }
        advanceTimeBy(100)

        assertEquals(4_242L, (repository.state.value as NowPlayingState.Answered).reading.readAtMs)
    }

    @Test
    fun `makes no request at all until something subscribes`() = runTest {
        // A poll costs the station a log line and may cost it a counted listener, so an app in the
        // background with the player stopped has to be silent.
        var calls = 0
        repository { calls += 1; answer(1) }

        advanceTimeBy(30_000)

        assertEquals(0, calls)
    }
}
