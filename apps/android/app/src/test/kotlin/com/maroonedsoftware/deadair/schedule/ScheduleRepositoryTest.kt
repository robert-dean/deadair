package com.maroonedsoftware.deadair.schedule

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.PersonaPortrait
import com.maroonedsoftware.deadair.sdk.models.ScheduleNow
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlot
import java.io.IOException
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
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
@OptIn(ExperimentalCoroutinesApi::class, ExperimentalUuidApi::class)
class ScheduleRepositoryTest {
    private val now = ScheduleNow(now = "2026-09-06 20:30:00", upcoming = emptyList())

    private class Counts {
        var current = 0
        var slots = 0
        var personas = 0
        var portraits = 0
    }

    private fun repositoryFor(
        session: MutableStateFlow<SessionState>,
        counts: Counts,
        scope: kotlinx.coroutines.CoroutineScope,
        portraits: suspend () -> List<PersonaPortrait> = { emptyList() },
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
        readPortraits = {
            counts.portraits += 1
            portraits()
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
        assertEquals(1, counts.portraits)
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
    fun `a retry asks at once and forgets the backoff`() = runTest {
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        var fail = true
        val repository = repositoryFor(session, counts, backgroundScope) { if (fail) throw IOException("down") else now }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        advanceTimeBy(ScheduleRepository.POLL_MS * 2 + 1)
        val before = counts.current
        assertEquals(2, before)

        fail = false
        repository.retry()
        advanceTimeBy(1)
        assertEquals(before + 1, counts.current)
        assertTrue(repository.state.value is ScheduleState.Answered)

        advanceTimeBy(ScheduleRepository.POLL_MS + 1)
        assertEquals(before + 2, counts.current)
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

    @Test
    fun `a station that cannot say who has a picture still shows its schedule`() = runTest {
        // A station from before portraits answers the list with a 404. That is a schedule with no
        // faces in it, not a schedule that cannot be shown, and it is not asked again every poll.
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        val repository = repositoryFor(session, counts, backgroundScope, portraits = { throw IOException("404") }) { now }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(ScheduleRepository.POLL_MS * 3 + 1)

        val state = repository.state.value as ScheduleState.Answered
        assertEquals(emptyList<PersonaPortrait>(), state.reading.portraits)
        assertEquals(1, counts.portraits)
        job.cancel()
    }

    @Test
    fun `carries the portraits on every reading`() = runTest {
        val cass = PersonaPortrait(personaId = Uuid.parse("0b5c6a52-9a3e-4f43-9d0c-6f1f0f0e7a11"), url = "/art/cass")
        val counts = Counts()
        val session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))
        val repository = repositoryFor(session, counts, backgroundScope, portraits = { listOf(cass) }) { now }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(ScheduleRepository.POLL_MS * 2 + 1)

        assertEquals(listOf(cass), (repository.state.value as ScheduleState.Answered).reading.portraits)
        job.cancel()
    }
}
