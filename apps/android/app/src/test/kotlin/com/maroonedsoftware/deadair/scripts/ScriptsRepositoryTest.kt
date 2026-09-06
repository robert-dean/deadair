package com.maroonedsoftware.deadair.scripts

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.sdk.models.ScriptHistoryPage
import com.maroonedsoftware.deadair.sdk.models.ScriptHistoryQuery
import com.maroonedsoftware.deadair.sdk.models.ScriptOutcome
import com.maroonedsoftware.deadair.sdk.models.ScriptRating
import kotlin.time.Instant
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ScriptsRepositoryTest {
    private fun attempt(id: String, rating: ScriptRating? = null) =
        ScriptAttempt(id = id, at = Instant.parse("2026-09-06T20:00:00Z"), kind = "link", writer = "model", outcome = ScriptOutcome.WRITTEN, script = "words $id", rating = rating)

    @Test
    fun `polls the head every thirty seconds, narrowed to the break it was opened for`() = runTest {
        val seen = mutableListOf<ScriptHistoryQuery>()
        val repository =
            ScriptsRepository(
                session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com")),
                segmentId = "seg-1",
                fetch = { query ->
                    seen += query
                    ScriptHistoryPage(attempts = listOf(attempt("a")))
                },
                nowEpochMs = { 0L },
                scope = backgroundScope,
            )
        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(ScriptsRepository.POLL_MS * 2 + 1)

        assertEquals(3, seen.size)
        assertEquals("seg-1", seen.first().segmentId)
        assertEquals(ScriptsRepository.PAGE, seen.first().limit)
        assertNull(seen.first().before)
        job.cancel()
    }

    @Test
    fun `a replaced attempt shows at once and the next poll takes over`() = runTest {
        val repository =
            ScriptsRepository(
                session = MutableStateFlow<SessionState>(SessionState.SignedIn("operator@example.com")),
                fetch = { ScriptHistoryPage(attempts = listOf(attempt("a"), attempt("b"))) },
                nowEpochMs = { 0L },
                scope = backgroundScope,
            )
        val job = backgroundScope.launch { repository.state.collect {} }
        advanceTimeBy(1)

        repository.replace(attempt("b", rating = ScriptRating.LIKED))
        advanceTimeBy(1)
        val shown = (repository.state.value as ScriptsState.Loaded).attempts
        assertEquals(listOf("a", "b"), shown.map { it.id })
        assertEquals(ScriptRating.LIKED, shown[1].rating)

        advanceTimeBy(ScriptsRepository.POLL_MS)
        assertNull((repository.state.value as ScriptsState.Loaded).attempts[1].rating)
        job.cancel()
    }
}
