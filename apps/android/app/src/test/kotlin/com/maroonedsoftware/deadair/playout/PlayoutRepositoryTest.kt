package com.maroonedsoftware.deadair.playout

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.models.AirMode
import com.maroonedsoftware.deadair.sdk.models.AirSource
import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.SilenceCause
import com.maroonedsoftware.deadair.sdk.models.StationAir
import com.maroonedsoftware.deadair.sdk.models.StationSilence
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlayoutRepositoryTest {
    private fun status(listeners: Long = 0) =
        PlayoutStatus(
            streamUp = true,
            onAir = false,
            mountPath = "/live",
            mounts = emptyList(),
            upNext = emptyList(),
            queuedCount = 0,
            listeners = listeners,
            audience = false,
            staleStreamConfig = emptyList(),
            silence = StationSilence(audible = false, cause = SilenceCause.NO_AUDIENCE, detail = "quiet", checks = emptyList()),
        )

    private val air = StationAir(active = true, airMode = AirMode.AUDIENCE, remaining = 3, airSource = AirSource.SCHEDULE, held = false)

    private class Seen {
        var statusReads = 0
        var airReads = 0
    }

    private fun signedIn() = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))

    private fun repositoryFor(
        session: MutableStateFlow<SessionState>,
        seen: Seen,
        scope: kotlinx.coroutines.CoroutineScope,
        readStatus: suspend () -> PlayoutStatus = { status() },
    ) = PlayoutRepository(
        session = session,
        readStatus = {
            seen.statusReads += 1
            readStatus()
        },
        readAir = {
            seen.airReads += 1
            air
        },
        nowEpochMs = { 1_000L },
        scope = scope,
    )

    @Test
    fun `asks nothing while signed out`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(MutableStateFlow(SessionState.SignedOut), seen, backgroundScope)

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(30_000)

        assertEquals(PlayoutState.SignedOut, repository.state.value)
        assertEquals(0, seen.statusReads + seen.airReads)
        job.cancel()
    }

    @Test
    fun `polls status every two seconds and air every five`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope)

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(10_001)

        // One straight away, then at 2, 4, 6, 8 and 10 seconds.
        assertEquals(6, seen.statusReads)
        // One straight away, then at 5 and 10.
        assertEquals(3, seen.airReads)
        val loaded = repository.state.value as PlayoutState.Loaded
        assertEquals(air, loaded.air)
        assertEquals(1_000L, loaded.lastGoodAtMs)
        job.cancel()
    }

    @Test
    fun `an applied status shows at once and yields to the next poll`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope)
        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)

        repository.apply(status(listeners = 9))
        advanceTimeBy(1)
        assertEquals(9, (repository.state.value as PlayoutState.Loaded).status.listeners)

        advanceTimeBy(PlayoutRepository.STATUS_POLL_MS)
        assertEquals(0, (repository.state.value as PlayoutState.Loaded).status.listeners)
        job.cancel()
    }

    @Test
    fun `refetchSoon reads again at the three follow-ups`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope)
        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        assertEquals(1, seen.statusReads)

        repository.refetchSoon()
        advanceTimeBy(401)
        assertEquals(2, seen.statusReads)
        advanceTimeBy(600)
        assertEquals(3, seen.statusReads)
        advanceTimeBy(1_500)
        assertEquals(4, seen.statusReads)
        // The air poll was kicked along with it.
        assertEquals(4, seen.airReads)
        job.cancel()
    }

    @Test
    fun `keeps the last reading and marks it stale when the station stops answering`() = runTest {
        var failing = false
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope) { if (failing) throw IOException("gone") else status(listeners = 2) }
        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)

        failing = true
        advanceTimeBy(PlayoutRepository.STATUS_POLL_MS + 1)

        val loaded = repository.state.value as PlayoutState.Loaded
        assertTrue(loaded.stale)
        assertEquals(2, loaded.status.listeners)
        job.cancel()
    }

    @Test
    fun `is unreachable rather than loading when it has never answered`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope) { throw IOException("gone") }
        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)

        assertEquals(PlayoutState.Unreachable, repository.state.value)
        job.cancel()
    }
}
