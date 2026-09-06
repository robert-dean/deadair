package com.maroonedsoftware.deadair.schedule

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.ScheduleNow
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlot
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The cadence, and what happens when a read fails.
 *
 * Everything runs on virtual time, and the three reads are plain suspend functions rather than an
 * HTTP client — the same split `NowPlayingRepositoryTest` documents and for the same reason: a real
 * engine dispatches onto threads virtual time cannot see, and the policy is what has the bugs.
 *
 * The two facts worth pinning are that a signed-out install makes no request at all, and that the
 * slot and persona lists are not re-read on every poll. Both are about not spending a listener's
 * session on answers nobody asked for.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScheduleRepositoryTest {
    private val now = ScheduleNow(now = "2026-09-06 20:30:00", upcoming = emptyList())

    private class Counts {
        var current = 0
        var slots = 0
        var personas = 0
    }

    private fun repositoryFor(
        session: MutableStateFlow<SessionState>,
        counts: Counts,
        scope: kotlinx.coroutines.CoroutineScope,
        current: suspend () -> ScheduleNow,
    ) = ScheduleRepository(
        session = session,
        readCurrent = {
            counts.current += 1
            current()
        },
        readSlots = {
            counts.slots += 1
            emptyList<ScheduleSlot>()
        },
        readPersonas = {
            counts.personas += 1
            emptyList<Persona>()
        },
        scope = scope,
    )

    @Test
    fun `asks the station nothing at all while signed out`() = runTest {
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedOut)
        val repository = repositoryFor(session, counts, backgroundScope) { now }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(120_000)

        assertEquals(ScheduleState.SignedOut, repository.state.value)
        assertEquals(0, counts.current)
        assertEquals(0, counts.slots)
        job.cancel()
    }

    @Test
    fun `polls the clock every half minute once signed in`() = runTest {
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        val repository = repositoryFor(session, counts, backgroundScope) { now }

        val job = backgroundScope.launch { repository.state.collect {} }
        // One read immediately, then one per interval. Two minutes is the first plus four.
        advanceTimeBy(ScheduleRepository.POLL_MS * 4 + 1)

        assertEquals(5, counts.current)
        job.cancel()
    }

    @Test
    fun `reads the names once rather than on every poll`() = runTest {
        // A slot list and a persona list change when an operator edits the schedule, which is to say
        // almost never. Re-reading them three times a minute would be three requests for an answer
        // that has not moved.
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        val repository = repositoryFor(session, counts, backgroundScope) { now }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(ScheduleRepository.POLL_MS * 10 + 1)

        assertEquals(11, counts.current)
        assertEquals(1, counts.slots)
        assertEquals(1, counts.personas)
        job.cancel()
    }

    @Test
    fun `keeps the last good reading when the station stops answering`() = runTest {
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        var fail = false
        val repository =
            repositoryFor(session, counts, backgroundScope) {
                if (fail) throw IOException("no route to host") else now
            }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        assertTrue(repository.state.value is ScheduleState.Answered)

        fail = true
        advanceTimeBy(ScheduleRepository.POLL_MS + 1)

        // Unreachable, but carrying what it last knew: blanking on one failed poll would make every
        // hiccup look like the station losing its schedule.
        val state = repository.state.value as ScheduleState.Unreachable
        assertEquals(now, state.lastGood?.now)
        job.cancel()
    }

    @Test
    fun `backs off while the station is down rather than hammering it`() = runTest {
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        val repository = repositoryFor(session, counts, backgroundScope) { throw IOException("down") }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(ScheduleRepository.POLL_MS * 4 + 1)

        // Five polls at a steady interval; fewer, because each failure doubles the wait.
        assertTrue("expected fewer than five reads, got ${counts.current}", counts.current < 5)
        job.cancel()
    }

    @Test
    fun `stops polling and says so when the session ends`() = runTest {
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        val repository = repositoryFor(session, counts, backgroundScope) { now }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        val whileSignedIn = counts.current

        session.value = SessionState.SignedOut
        advanceTimeBy(ScheduleRepository.POLL_MS * 3)

        assertEquals(ScheduleState.SignedOut, repository.state.first())
        assertEquals(whileSignedIn, counts.current)
        job.cancel()
    }
}
