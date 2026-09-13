package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.nowplaying.Reading
import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.sdk.models.NowPlayingTrack
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The sleep timer, on virtual time, exactly as `NowPlayingGateTest` drives the gate.
 *
 * What matters most is the stop: that it happens at the deadline and not before, that it is a stop
 * and the sound comes back for the next play, and that "after this record" waits for the record the
 * LISTENER is hearing rather than the one the station has already moved past.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SleepTimerTest {
    private class Recorder {
        var stops = 0
        val volumes = mutableListOf<Float>()
        val published = mutableListOf<SleepState>()
    }

    private fun TestScope.timer(recorder: Recorder = Recorder()) =
        recorder to
            SleepTimer(
                schedule = { ms, run -> backgroundScope.launch { delay(ms); run() }.let { job -> { job.cancel() } } },
                now = { currentTime },
                fade = { recorder.volumes += it },
                stop = { recorder.stops += 1 },
                publish = { recorder.published += it },
            )

    private fun reading(startedAt: Long, remainingMs: Long?, readAtMs: Long) =
        Reading(
            NowPlaying(
                station = "Test FM",
                onAir = true,
                listeners = 1,
                mounts = emptyList(),
                track = NowPlayingTrack(title = "A Song", artist = "Someone", durationMs = 200_000, startedAt = startedAt, remainingMs = remainingMs),
            ),
            readAtMs,
        )

    @Test
    fun `stops when the time is up and not before`() = runTest {
        val (rec, timer) = timer()

        timer.arm(SleepRequest.Minutes(15))
        advanceTimeBy(15 * 60_000L - 1)
        assertEquals(0, rec.stops)

        advanceTimeBy(2)
        assertEquals(1, rec.stops)
        assertEquals(SleepState.Off, timer.state)
    }

    @Test
    fun `fades over the last ten seconds, then stops, then puts the sound back`() = runTest {
        val (rec, timer) = timer()

        timer.arm(SleepRequest.Minutes(1))
        advanceTimeBy(50_000)
        assertTrue(rec.volumes.isEmpty())

        advanceTimeBy(10_001)
        // Falling, never rising, until the stop; then back to full for the next press of play.
        val fall = rec.volumes.dropLast(1)
        assertTrue(fall.isNotEmpty())
        assertEquals(fall.sortedDescending(), fall)
        assertTrue(fall.last() < 0.2f)
        assertEquals(1f, rec.volumes.last())
        assertEquals(1, rec.stops)
    }

    @Test
    fun `turning it off mid-fade cancels the stop and puts the sound back`() = runTest {
        val (rec, timer) = timer()

        timer.arm(SleepRequest.Minutes(1))
        advanceTimeBy(55_000)
        timer.clear()
        advanceTimeBy(60_000)

        assertEquals(0, rec.stops)
        assertEquals(1f, rec.volumes.last())
        assertEquals(SleepState.Off, timer.state)
    }

    @Test
    fun `a second choice replaces the first`() = runTest {
        val (rec, timer) = timer()

        timer.arm(SleepRequest.Minutes(15))
        timer.arm(SleepRequest.Minutes(30))
        advanceTimeBy(20 * 60_000L)
        assertEquals(0, rec.stops)

        advanceTimeBy(10 * 60_000L + 1)
        assertEquals(1, rec.stops)
    }

    @Test
    fun `after this record waits for the listener, by the reading's age and what the player holds`() = runTest {
        val (rec, timer) = timer()
        advanceTimeBy(5_000)
        // Read at 0 with 30 s left, and 4 s of audio in the player: the listener hears the end at 34 s.
        timer.onPoll(reading(startedAt = 1, remainingMs = 30_000, readAtMs = 0), bufferedMs = 4_000)

        timer.arm(SleepRequest.AfterRecord)
        assertEquals(SleepState.AfterRecord(34_000), timer.state)

        advanceTimeBy(34_000 - currentTime - 1)
        assertEquals(0, rec.stops)
        advanceTimeBy(2)
        assertEquals(1, rec.stops)
    }

    @Test
    fun `after this record re-anchors on each reading of the same record`() = runTest {
        val (_, timer) = timer()
        timer.onPoll(reading(startedAt = 1, remainingMs = 30_000, readAtMs = 0), bufferedMs = 0)
        timer.arm(SleepRequest.AfterRecord)
        assertEquals(SleepState.AfterRecord(30_000), timer.state)

        // The station now says there is more left than it did: a length that was wrong.
        advanceTimeBy(3_000)
        timer.onPoll(reading(startedAt = 1, remainingMs = 40_000, readAtMs = 3_000), bufferedMs = 0)

        assertEquals(SleepState.AfterRecord(43_000), timer.state)
    }

    @Test
    fun `after this record fires once the buffer drains when the record moves on early`() = runTest {
        val (rec, timer) = timer()
        timer.onPoll(reading(startedAt = 1, remainingMs = 120_000, readAtMs = 0), bufferedMs = 0)
        timer.arm(SleepRequest.AfterRecord)

        // The operator skipped: something else is on, and the listener is 6 s behind the station.
        advanceTimeBy(10_000)
        timer.onPoll(reading(startedAt = 2, remainingMs = 200_000, readAtMs = 10_000), bufferedMs = 6_000)
        assertEquals(SleepState.AfterRecord(16_000), timer.state)

        advanceTimeBy(6_001)
        assertEquals(1, rec.stops)
    }

    @Test
    fun `after this record waits, with no deadline, until a reading can say`() = runTest {
        val (rec, timer) = timer()

        timer.arm(SleepRequest.AfterRecord)
        assertEquals(SleepState.AfterRecord(null), timer.state)
        advanceTimeBy(600_000)
        assertEquals(0, rec.stops)

        timer.onPoll(reading(startedAt = 1, remainingMs = 20_000, readAtMs = currentTime), bufferedMs = 0)
        assertEquals(SleepState.AfterRecord(currentTime + 20_000), timer.state)
    }

    @Test
    fun `a stop by hand turns it off`() = runTest {
        val (rec, timer) = timer()

        timer.arm(SleepRequest.Minutes(15))
        timer.onStopped()
        advanceTimeBy(30 * 60_000L)

        assertEquals(0, rec.stops)
        assertEquals(SleepState.Off, timer.state)
    }

    @Test
    fun `says every change to whoever shows it`() = runTest {
        val (rec, timer) = timer()

        timer.arm(SleepRequest.Minutes(1))
        runCurrent()
        timer.clear()

        assertEquals(listOf(SleepState.Until(60_000), SleepState.Off), rec.published)
    }
}
