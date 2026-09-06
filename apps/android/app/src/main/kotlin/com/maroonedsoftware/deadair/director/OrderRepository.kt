package com.maroonedsoftware.deadair.director

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.net.Kick
import com.maroonedsoftware.deadair.sdk.models.StationOrder
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

private data class Reading(val order: StationOrder?, val stale: Boolean, val lastGoodAtMs: Long? = null)

/**
 * The station's running order, polled while the Up next tab is up.
 *
 * Five seconds, the console's own cadence: the order moves at the pace of records, and a boundary
 * is the only thing that changes it on its own. An action answers with the order it produced, which
 * `apply` puts on screen at once; an extend answers 202 and nothing, which is what `refetchSoon`
 * with the longer delays is for — the refill lands seconds later, at the station's pace.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OrderRepository(
    session: Flow<SessionState>,
    private val read: suspend () -> StationOrder,
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    private val scope: CoroutineScope,
) {
    private val kick = Kick()
    private val applied = MutableStateFlow<StationOrder?>(null)

    fun retry() = kick.kick()

    fun apply(order: StationOrder) {
        applied.value = order
    }

    /** Each delay from now, not from the read before it. */
    fun refetchSoon(delaysMs: List<Long> = FOLLOW_UP_MS) {
        for (wait in delaysMs) {
            scope.launch {
                delay(wait)
                kick.kick()
            }
        }
    }

    private val reading: Flow<Reading> =
        session.distinctUntilChanged().flatMapLatest { current ->
            applied.value = null
            if (current is SessionState.SignedIn) poll() else flow { emit(Reading(null, stale = false)) }
        }

    val state: StateFlow<OrderState> =
        combine(session.distinctUntilChanged(), reading, applied) { current, reading, applied ->
            val shown = applied ?: reading.order
            when {
                current !is SessionState.SignedIn -> OrderState.SignedOut
                shown == null -> if (reading.stale) OrderState.Unreachable else OrderState.Loading
                else -> OrderState.Loaded(order = shown, stale = reading.stale, lastGoodAtMs = reading.lastGoodAtMs)
            }
        }
            .stateIn(scope, SharingStarted.WhileSubscribed(SUBSCRIBER_GRACE_MS), OrderState.Loading)

    private fun poll(): Flow<Reading> = flow {
        var last: StationOrder? = null
        var lastGoodAtMs: Long? = null
        var failures = 0
        while (true) {
            try {
                last = read()
                lastGoodAtMs = nowEpochMs()
                failures = 0
                applied.value = null
                emit(Reading(last, stale = false, lastGoodAtMs = lastGoodAtMs))
            } catch (error: Exception) {
                failures += 1
                emit(Reading(last, stale = true, lastGoodAtMs = lastGoodAtMs))
            }
            if (kick.awaitOrDelay(intervalFor(failures))) failures = 0
        }
    }

    private fun intervalFor(failures: Int): Long {
        if (failures == 0) return POLL_MS
        return minOf(POLL_MS shl minOf(failures, MAX_DOUBLINGS), MAX_POLL_MS)
    }

    companion object {
        const val POLL_MS = 5_000L
        const val MAX_POLL_MS = 60_000L
        private const val MAX_DOUBLINGS = 4
        const val SUBSCRIBER_GRACE_MS = 5_000L

        /** After an action that answers with the order: one quick look, in case the player moved under it. */
        val FOLLOW_UP_MS: List<Long> = listOf(1_500L)

        /** After an extend, which answers 202 and fills the order at the station's own pace. */
        val REFILL_FOLLOW_UP_MS: List<Long> = listOf(1_500L, 4_000L, 8_000L)
    }
}
