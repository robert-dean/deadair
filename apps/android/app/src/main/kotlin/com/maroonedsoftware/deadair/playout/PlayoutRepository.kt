package com.maroonedsoftware.deadair.playout

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.net.Kick
import com.maroonedsoftware.deadair.sdk.models.PlayoutStatus
import com.maroonedsoftware.deadair.sdk.models.StationAir
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** One poll's latest answer, and whether it is current. */
private data class Reading<T>(val value: T?, val stale: Boolean, val lastGoodAtMs: Long? = null)

/**
 * The transport reading, polled while somebody is looking at it.
 *
 * ## Two clocks
 *
 * Status every two seconds and air every five, which are the console's own cadences: the first is
 * what an operator watches change under their hand, and the second changes only when somebody
 * changes it. Both stop within seconds of the last screen letting go, because a signed-in listener
 * who has switched tabs is not an operator watching a desk, and two polls a second per phone is a
 * real cost to a station on a home connection.
 *
 * ## `apply` and `refetchSoon`
 *
 * Every operator action answers with the status it produced, and that answer goes on screen at
 * once through `apply` rather than waiting up to two seconds for the poll to agree. The follow-up
 * fetches are what the console does after every action too: the answer to "skip" is the status the
 * instant after the skip, and the record actually changing at the encoder is a second or two behind
 * it, so a reading at 400 ms, 1 s and 2.5 s is what makes the screen settle on the truth rather
 * than on the promise.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PlayoutRepository(
    session: Flow<SessionState>,
    private val readStatus: suspend () -> PlayoutStatus,
    private val readAir: suspend () -> StationAir,
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val scope: CoroutineScope,
) {
    private val statusKick = Kick()
    private val airKick = Kick()

    /** A status an action just answered with, shown until the poll next answers. */
    private val applied = MutableStateFlow<PlayoutStatus?>(null)

    /** Ask again now and forget the backoff. */
    fun retry() {
        statusKick.kick()
        airKick.kick()
    }

    /** Put an action's answer on screen now rather than in up to two seconds. */
    fun apply(status: PlayoutStatus) {
        applied.value = status
    }

    /**
     * Read again a few times over the next seconds, which is when an action's effect lands at the
     * encoder. Each delay is measured from now, not from the read before it, so the three land
     * where the console's do.
     */
    fun refetchSoon(delaysMs: List<Long> = FOLLOW_UP_MS) {
        for (wait in delaysMs) {
            scope.launch {
                delay(wait)
                statusKick.kick()
                airKick.kick()
            }
        }
    }

    private val status: Flow<Reading<PlayoutStatus>> =
        session.distinctUntilChanged().flatMapLatest { current ->
            applied.value = null
            if (current is SessionState.SignedIn) poll(STATUS_POLL_MS, statusKick, readStatus) else flow { emit(Reading(null, stale = false)) }
        }

    private val air: Flow<Reading<StationAir>> =
        session.distinctUntilChanged().flatMapLatest { current ->
            if (current is SessionState.SignedIn) poll(AIR_POLL_MS, airKick, readAir) else flow { emit(Reading(null, stale = false)) }
        }

    val state: StateFlow<PlayoutState> =
        combine(session.distinctUntilChanged(), status, air, applied) { current, status, air, applied ->
            val shown = applied ?: status.value
            when {
                current !is SessionState.SignedIn -> PlayoutState.SignedOut
                shown == null -> if (status.stale) PlayoutState.Unreachable else PlayoutState.Loading
                else -> PlayoutState.Loaded(status = shown, air = air.value, stale = status.stale, lastGoodAtMs = status.lastGoodAtMs)
            }
        }
            .stateIn(scope, SharingStarted.WhileSubscribed(SUBSCRIBER_GRACE_MS), PlayoutState.Loading)

    private fun <T> poll(intervalMs: Long, kick: Kick, read: suspend () -> T): Flow<Reading<T>> = flow {
        var last: T? = null
        var lastGoodAtMs: Long? = null
        var failures = 0
        while (true) {
            try {
                last = read()
                lastGoodAtMs = nowEpochMs()
                failures = 0
                // A fresh poll supersedes whatever an action put up.
                applied.value = null
                emit(Reading(last, stale = false, lastGoodAtMs = lastGoodAtMs))
            } catch (error: Exception) {
                failures += 1
                emit(Reading(last, stale = true, lastGoodAtMs = lastGoodAtMs))
            }
            if (kick.awaitOrDelay(intervalFor(intervalMs, failures))) failures = 0
        }
    }

    /** Steady while it works, backing off while it does not, and never slower than a minute: this is a desk. */
    private fun intervalFor(base: Long, failures: Int): Long {
        if (failures == 0) return base
        return minOf(base shl minOf(failures, MAX_DOUBLINGS), MAX_POLL_MS)
    }

    companion object {
        const val STATUS_POLL_MS = 2_000L
        const val AIR_POLL_MS = 5_000L
        const val MAX_POLL_MS = 60_000L
        private const val MAX_DOUBLINGS = 5
        const val SUBSCRIBER_GRACE_MS = 5_000L

        /** When to look again after an action: the console's own three follow-ups. */
        val FOLLOW_UP_MS: List<Long> = listOf(400L, 1_000L, 2_500L)
    }
}
