package com.maroonedsoftware.deadair.history

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.models.HistoryEntry
import com.maroonedsoftware.deadair.sdk.models.HistoryPage
import com.maroonedsoftware.deadair.sdk.models.HistoryQuery
import java.io.IOException
import kotlin.time.Instant
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The two halves of the list, and what keeps them from disagreeing.
 *
 * The head is polled because the top of it changes; the tail is fetched once because history does
 * not. What that buys is not having to re-fetch four hundred rows every fifteen seconds to answer a
 * question with one permanent answer — and what it costs is that the two halves were read at
 * different moments, so the merge has to deduplicate. That is the case worth pinning: records air
 * while somebody scrolls, the newest fifty shift down, and the row that was fiftieth is suddenly in
 * both halves.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HistoryRepositoryTest {
    private fun entry(id: String) =
        HistoryEntry(id = id, airedAt = Instant.parse("2026-09-06T21:00:00Z"), title = "Record $id", artists = "Somebody")

    private fun page(ids: List<String>, nextBefore: String? = null) = HistoryPage(entries = ids.map(::entry), nextBefore = nextBefore)

    private class Seen {
        val queries = mutableListOf<HistoryQuery?>()
    }

    private fun repositoryFor(
        session: MutableStateFlow<SessionState>,
        seen: Seen,
        scope: kotlinx.coroutines.CoroutineScope,
        answer: suspend (HistoryQuery) -> HistoryPage,
    ) = HistoryRepository(
        session = session,
        fetch = { query ->
            seen.queries.add(query)
            answer(query)
        },
        scope = scope,
    )

    private fun signedIn() = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com"))

    @Test
    fun `asks the station nothing at all while signed out`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(MutableStateFlow(SessionState.SignedOut), seen, backgroundScope) { page(emptyList()) }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(60_000)

        assertEquals(HistoryState.SignedOut, repository.state.value)
        assertTrue(seen.queries.isEmpty())
        job.cancel()
    }

    @Test
    fun `polls the head every fifteen seconds and asks for a page at a time`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope) { page(listOf("a", "b")) }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(HistoryRepository.POLL_MS * 3 + 1)

        assertEquals(4, seen.queries.size)
        // Always the head: no cursor, one page.
        assertTrue(seen.queries.all { it?.before == null && it?.limit == HistoryRepository.PAGE })
        job.cancel()
    }

    @Test
    fun `says there is more only while the station says so`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope) { page(listOf("a"), nextBefore = "cursor-1") }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)

        assertTrue((repository.state.value as HistoryState.Loaded).canLoadMore)
        job.cancel()
    }

    @Test
    fun `walks back from the cursor the station gave it`() = runTest {
        val seen = Seen()
        val repository =
            repositoryFor(signedIn(), seen, backgroundScope) { query ->
                if (query.before == null) page(listOf("a", "b"), nextBefore = "cursor-1") else page(listOf("c", "d"), nextBefore = "cursor-2")
            }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        repository.loadMore()
        advanceTimeBy(1)

        val loaded = repository.state.value as HistoryState.Loaded
        assertEquals(listOf("a", "b", "c", "d"), loaded.entries.map { it.id })
        assertEquals("cursor-1", seen.queries.last()?.before)
        assertTrue(loaded.canLoadMore)
        job.cancel()
    }

    @Test
    fun `shows no record twice when the head has moved under the reader`() = runTest {
        // Records air while somebody scrolls, so the newest fifty shift down and the row that was
        // last is now in both halves. The keyset cursor stops the SERVER serving it twice; this is
        // the same problem on the client, arriving because the halves were read at different moments.
        val seen = Seen()
        var aired = false
        val repository =
            repositoryFor(signedIn(), seen, backgroundScope) { query ->
                when {
                    query.before != null -> page(listOf("b", "c"), nextBefore = "cursor-2")
                    aired -> page(listOf("new", "a", "b"), nextBefore = "cursor-1")
                    else -> page(listOf("a", "b"), nextBefore = "cursor-1")
                }
            }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        repository.loadMore()
        advanceTimeBy(1)

        aired = true
        advanceTimeBy(HistoryRepository.POLL_MS + 1)

        val loaded = repository.state.value as HistoryState.Loaded
        assertEquals(listOf("new", "a", "b", "c"), loaded.entries.map { it.id })
        job.cancel()
    }

    @Test
    fun `does nothing when there is nothing more to load`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope) { page(listOf("a"), nextBefore = null) }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        val before = seen.queries.size
        repository.loadMore()
        advanceTimeBy(1)

        assertEquals(before, seen.queries.size)
        assertFalse((repository.state.value as HistoryState.Loaded).canLoadMore)
        job.cancel()
    }

    @Test
    fun `keeps what it had when loading more fails`() = runTest {
        val seen = Seen()
        val repository =
            repositoryFor(signedIn(), seen, backgroundScope) { query ->
                if (query.before == null) page(listOf("a"), nextBefore = "cursor-1") else throw IOException("no route to host")
            }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        repository.loadMore()
        advanceTimeBy(1)

        val loaded = repository.state.value as HistoryState.Loaded
        assertEquals(listOf("a"), loaded.entries.map { it.id })
        assertFalse(loaded.loadingMore)
        job.cancel()
    }

    @Test
    fun `dims what it has rather than blanking it when the head stops answering`() = runTest {
        val seen = Seen()
        var fail = false
        val repository =
            repositoryFor(signedIn(), seen, backgroundScope) {
                if (fail) throw IOException("down") else page(listOf("a"))
            }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)

        fail = true
        advanceTimeBy(HistoryRepository.POLL_MS + 1)

        val loaded = repository.state.value as HistoryState.Loaded
        assertEquals(listOf("a"), loaded.entries.map { it.id })
        assertTrue(loaded.stale)
        job.cancel()
    }

    @Test
    fun `says it cannot reach the station when nothing ever arrived`() = runTest {
        val seen = Seen()
        val repository = repositoryFor(signedIn(), seen, backgroundScope) { throw IOException("down") }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)

        assertEquals(HistoryState.Unreachable, repository.state.value)
        job.cancel()
    }

    @Test
    fun `throws away a tail that belonged to another session`() = runTest {
        val seen = Seen()
        val session = signedIn()
        val repository =
            repositoryFor(session, seen, backgroundScope) { query ->
                if (query.before == null) page(listOf("a"), nextBefore = "cursor-1") else page(listOf("b"), nextBefore = null)
            }

        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)
        repository.loadMore()
        advanceTimeBy(1)
        assertEquals(2, (repository.state.value as HistoryState.Loaded).entries.size)

        session.value = SessionState.SignedOut
        advanceTimeBy(1)
        session.value = SessionState.SignedIn("someone.else@example.com")
        advanceTimeBy(1)

        // Back to the head alone: the pages walked back were the other account's view.
        assertEquals(listOf("a"), (repository.state.value as HistoryState.Loaded).entries.map { it.id })
        job.cancel()
    }
}
