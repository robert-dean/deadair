package com.maroonedsoftware.deadair.scripts

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.net.Kick
import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.sdk.models.ScriptHistoryPage
import com.maroonedsoftware.deadair.sdk.models.ScriptHistoryQuery
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private data class Head(val attempts: List<ScriptAttempt>, val nextBefore: String?, val stale: Boolean, val everAnswered: Boolean, val lastGoodAtMs: Long? = null)

private data class Tail(val attempts: List<ScriptAttempt>, val nextBefore: String?, val loading: Boolean)

/**
 * What the station has said between the records, newest first.
 *
 * `HistoryRepository`'s shape exactly — a polled head and a tail walked back by hand, merged by id
 * — because it is the same problem: a feed whose top moves every few minutes and whose past does
 * not. Thirty seconds rather than fifteen, because a break is written when it comes round and
 * there are fewer of them than there are records.
 *
 * `replace` is for a rating: the write answers with the attempt as the station now has it, and
 * that row is swapped in at once rather than waiting for the next poll to agree. Only until the
 * next poll, which carries the rating anyway.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScriptsRepository(
    session: Flow<SessionState>,
    /** Narrowed to one break when set, which is what a running-order row opens. */
    private val segmentId: String? = null,
    private val fetch: suspend (ScriptHistoryQuery) -> ScriptHistoryPage,
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    scope: CoroutineScope,
) {
    private val kick = Kick()

    fun retry() = kick.kick()

    private val tail = MutableStateFlow(Tail(emptyList(), null, loading = false))
    private val replaced = MutableStateFlow<Map<String, ScriptAttempt>>(emptyMap())
    private val loadLock = Mutex()

    /** Put the attempt as the station now has it in place of the one on screen. */
    fun replace(attempt: ScriptAttempt) {
        replaced.value = replaced.value + (attempt.id to attempt)
    }

    private val head: Flow<Head> =
        session.distinctUntilChanged().flatMapLatest { current ->
            tail.value = Tail(emptyList(), null, loading = false)
            replaced.value = emptyMap()
            if (current is SessionState.SignedIn) pollHead() else flow { emit(EMPTY_HEAD) }
        }

    val state: StateFlow<ScriptsState> =
        combine(session.distinctUntilChanged(), head, tail, replaced) { current, head, tail, replaced ->
            when {
                current !is SessionState.SignedIn -> ScriptsState.SignedOut
                !head.everAnswered -> if (head.stale) ScriptsState.Unreachable else ScriptsState.Loading
                else ->
                    ScriptsState.Loaded(
                        attempts = merge(head.attempts, tail.attempts).map { replaced[it.id] ?: it },
                        canLoadMore = (if (tail.attempts.isEmpty()) head.nextBefore else tail.nextBefore) != null,
                        loadingMore = tail.loading,
                        stale = head.stale,
                        lastGoodAtMs = head.lastGoodAtMs,
                    )
            }
        }
            .stateIn(scope, SharingStarted.WhileSubscribed(SUBSCRIBER_GRACE_MS), ScriptsState.Loading)

    suspend fun loadMore() {
        if (!loadLock.tryLock()) return
        try {
            val current = tail.value
            val cursor = (if (current.attempts.isEmpty()) headCursor else current.nextBefore) ?: return
            tail.value = current.copy(loading = true)
            try {
                val page = fetch(ScriptHistoryQuery(limit = PAGE, before = cursor, segmentId = segmentId))
                tail.value = Tail(attempts = merge(current.attempts, page.attempts), nextBefore = page.nextBefore, loading = false)
            } catch (error: Exception) {
                tail.value = current.copy(loading = false)
            }
        } finally {
            loadLock.unlock()
        }
    }

    @Volatile
    private var headCursor: String? = null

    private fun pollHead(): Flow<Head> = flow {
        var attempts: List<ScriptAttempt> = emptyList()
        var nextBefore: String? = null
        var everAnswered = false
        var lastGoodAtMs: Long? = null
        var failures = 0
        while (true) {
            try {
                val page = fetch(ScriptHistoryQuery(limit = PAGE, segmentId = segmentId))
                attempts = page.attempts
                nextBefore = page.nextBefore
                headCursor = page.nextBefore
                everAnswered = true
                lastGoodAtMs = nowEpochMs()
                failures = 0
                // A fresh page carries every rating, so nothing swapped in is newer than it.
                replaced.value = emptyMap()
                emit(Head(attempts, nextBefore, stale = false, everAnswered = true, lastGoodAtMs = lastGoodAtMs))
            } catch (error: Exception) {
                failures += 1
                emit(Head(attempts, nextBefore, stale = true, everAnswered = everAnswered, lastGoodAtMs = lastGoodAtMs))
            }
            if (kick.awaitOrDelay(intervalFor(failures))) failures = 0
        }
    }

    private fun merge(head: List<ScriptAttempt>, tail: List<ScriptAttempt>): List<ScriptAttempt> {
        if (tail.isEmpty()) return head
        val seen = head.mapTo(HashSet()) { it.id }
        return head + tail.filter { seen.add(it.id) }
    }

    private fun intervalFor(failures: Int): Long {
        if (failures == 0) return POLL_MS
        return minOf(POLL_MS shl minOf(failures, MAX_DOUBLINGS), MAX_POLL_MS)
    }

    companion object {
        const val POLL_MS = 30_000L
        const val MAX_POLL_MS = 300_000L
        private const val MAX_DOUBLINGS = 3
        const val PAGE = 50L
        const val SUBSCRIBER_GRACE_MS = 5_000L
        private val EMPTY_HEAD = Head(emptyList(), null, stale = false, everAnswered = false)
    }
}
