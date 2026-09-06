package com.maroonedsoftware.deadair.history

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.net.Kick
import com.maroonedsoftware.deadair.sdk.models.HistoryEntry
import com.maroonedsoftware.deadair.sdk.models.HistoryPage
import com.maroonedsoftware.deadair.sdk.models.HistoryQuery
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

/** The head of the list, as the poll last left it. */
private data class Head(
    val entries: List<HistoryEntry>,
    val nextBefore: String?,
    val stale: Boolean,
    val everAnswered: Boolean,
    val lastGoodAtMs: Long? = null,
)

/** Pages walked back from the head by hand. */
private data class Tail(val entries: List<HistoryEntry>, val nextBefore: String?, val loading: Boolean)

/**
 * What the station has played, newest first.
 *
 * ## Two halves that move at different speeds
 *
 * The head is polled, because the top of this list changes every few minutes and a listener who has
 * just heard something wants to see it named. Everything behind the head is fetched once, when
 * somebody asks for it, and then left alone: it is history, and history does not change.
 *
 * That is why the head and the tail are kept apart rather than as one growing list. Re-polling
 * everything a listener had scrolled through would be a page of fifty turning into four hundred
 * rows re-fetched every fifteen seconds, to answer a question — what did this station play three
 * hours ago — that has one answer forever.
 *
 * ## Why the merge deduplicates
 *
 * The head grows under the reader: records air while somebody is scrolling, so the newest fifty
 * shift down and the row that was fiftieth is now in the tail as well. Merging by id rather than by
 * position is what keeps that from showing the same record twice. The keyset cursor is what keeps
 * the SERVER from serving it twice; this is the same problem on the client, arriving because the
 * two halves were fetched at different moments.
 *
 * There is a gap this cannot close: if more records air than a head page holds while somebody has
 * the tail loaded, the rows between the head's oldest and the tail's newest are missed until the
 * screen is reopened. That is fifty records, which is several hours of radio, and the cost of
 * closing it is re-fetching the whole list on every poll.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HistoryRepository(
    session: Flow<SessionState>,
    /** One page. A function rather than the SDK, for the reason every other repository here takes one. */
    private val fetch: suspend (HistoryQuery) -> HistoryPage,
    /** The wall clock, for saying how old a stale list is. Injected so the tests can hold it still. */
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    scope: CoroutineScope,
) {
    private val kick = Kick()

    /** Ask for the head again now, and forget the backoff. What a Retry button and a pull to refresh mean. */
    fun retry() = kick.kick()

    private val tail = MutableStateFlow(Tail(emptyList(), null, loading = false))

    /** One `loadMore` at a time: two would both start from the same cursor and fetch the same page. */
    private val loadLock = Mutex()

    private val head: Flow<Head> =
        session
            .distinctUntilChanged()
            .flatMapLatest { current ->
                // A session change makes the tail somebody else's: a different account, or none.
                tail.value = Tail(emptyList(), null, loading = false)
                // The signed-out branch still emits, and has to: `combine` below produces nothing
                // until every one of its sources has, so a silent branch here would leave the
                // screen on `Loading` forever rather than offering the sign-in.
                if (current is SessionState.SignedIn) pollHead() else flow { emit(EMPTY_HEAD) }
            }

    val state: StateFlow<HistoryState> =
        combine(session.distinctUntilChanged(), head, tail) { current, head, tail ->
            if (current !is SessionState.SignedIn) {
                HistoryState.SignedOut
            } else if (!head.everAnswered) {
                if (head.stale) HistoryState.Unreachable else HistoryState.Loading
            } else {
                val merged = merge(head.entries, tail.entries)
                HistoryState.Loaded(
                    entries = merged,
                    // The tail's cursor once there is a tail, the head's until then.
                    canLoadMore = (if (tail.entries.isEmpty()) head.nextBefore else tail.nextBefore) != null,
                    loadingMore = tail.loading,
                    stale = head.stale,
                    lastGoodAtMs = head.lastGoodAtMs,
                )
            }
        }
            .stateIn(scope, SharingStarted.WhileSubscribed(SUBSCRIBER_GRACE_MS), HistoryState.Loading)

    /**
     * Fetch the page behind what is showing.
     *
     * Does nothing when a fetch is already running or when the list has been read to its end, so a
     * screen may call it on every scroll without checking first. A failure leaves the list as it
     * was: a listener who could not load more still has what they had.
     */
    suspend fun loadMore() {
        if (!loadLock.tryLock()) return
        try {
            val current = tail.value
            val cursor = (if (current.entries.isEmpty()) headCursor else current.nextBefore) ?: return

            tail.value = current.copy(loading = true)
            try {
                val page = fetch(HistoryQuery(limit = PAGE, before = cursor))
                tail.value = Tail(entries = merge(current.entries, page.entries), nextBefore = page.nextBefore, loading = false)
            } catch (error: Exception) {
                tail.value = current.copy(loading = false)
            }
        } finally {
            loadLock.unlock()
        }
    }

    /** The head's own cursor, kept beside the flow so `loadMore` can start from it. */
    @Volatile
    private var headCursor: String? = null

    private fun pollHead(): Flow<Head> = flow {
        var entries: List<HistoryEntry> = emptyList()
        var nextBefore: String? = null
        var everAnswered = false
        var lastGoodAtMs: Long? = null
        var failures = 0

        while (true) {
            try {
                val page = fetch(HistoryQuery(limit = PAGE))
                entries = page.entries
                nextBefore = page.nextBefore
                headCursor = page.nextBefore
                everAnswered = true
                lastGoodAtMs = nowEpochMs()
                failures = 0
                emit(Head(entries, nextBefore, stale = false, everAnswered = true, lastGoodAtMs = lastGoodAtMs))
            } catch (error: Exception) {
                failures += 1
                emit(Head(entries, nextBefore, stale = true, everAnswered = everAnswered, lastGoodAtMs = lastGoodAtMs))
            }
            if (kick.awaitOrDelay(intervalFor(failures))) failures = 0
        }
    }

    /** Head first, then whatever of the tail the head does not already carry. */
    private fun merge(head: List<HistoryEntry>, tail: List<HistoryEntry>): List<HistoryEntry> {
        if (tail.isEmpty()) return head
        val seen = head.mapTo(HashSet()) { it.id }
        return head + tail.filter { seen.add(it.id) }
    }

    /** Steady while it works, backing off while it does not — the shape every poll in this app uses. */
    private fun intervalFor(failures: Int): Long {
        if (failures == 0) return POLL_MS
        val backed = POLL_MS shl minOf(failures, MAX_DOUBLINGS)
        return minOf(backed, MAX_POLL_MS)
    }

    companion object {
        /** What the console polls the head of its own feed at, and only ever the head. */
        const val POLL_MS = 15_000L
        const val MAX_POLL_MS = 300_000L
        private const val MAX_DOUBLINGS = 5

        /** A screenful and a bit, matching the server's own default. */
        const val PAGE = 50L

        const val SUBSCRIBER_GRACE_MS = 5_000L

        private val EMPTY_HEAD = Head(emptyList(), null, stale = false, everAnswered = false)
    }
}
