package com.maroonedsoftware.deadair.schedule

import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.net.Kick
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.sdk.models.ScheduleNow
import com.maroonedsoftware.deadair.sdk.models.ScheduleSlot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.stateIn

/**
 * What the station is scheduled to be doing, polled.
 *
 * A poll for the reason `NowPlayingRepository` is one: the API offers nothing else, and the console
 * polls the same route on the same interval. **The polling stops on its own when nobody is looking**
 * — `WhileSubscribed` means the loop runs only while the tab is on screen — which matters more here
 * than it would elsewhere, because every request is one a signed-in listener is spending a session
 * on and a line in the station's log.
 *
 * ## Three reads, two cadences
 *
 * `/schedule/current` is the clock and the blocks and moves every half minute, which is what the
 * console polls it at. The slot list and the persona list are what turn a block id into a name and
 * a host, and they change when an operator edits the schedule — which is to say almost never, and
 * never on a timer. So they are read once when the screen opens and again only when they have gone
 * stale, rather than three times a minute for an answer that has not moved.
 *
 * ## Signed out is not an error
 *
 * The whole screen is behind `platform.view`, so an accountless install has nothing to poll — and
 * asking anyway would produce a 401 every thirty seconds and a screen that reads like a fault
 * rather than like an offer. The state says signed out and no request is made at all.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ScheduleRepository(
    session: Flow<SessionState>,
    /**
     * The three reads, as functions. The same seam `NowPlayingRepository` takes and for the same
     * reason: what this class is FOR is the cadence and what happens when a read fails, and neither
     * needs an HTTP client to be exercised.
     */
    private val readCurrent: suspend () -> ScheduleNow,
    private val readSlots: suspend () -> List<ScheduleSlot>,
    private val readPersonas: suspend () -> List<Persona>,
    /** The wall clock, for saying how old a stale reading is. Injected so the tests can hold it still. */
    private val nowEpochMs: () -> Long = System::currentTimeMillis,
    scope: CoroutineScope,
) {
    private val kick = Kick()

    /** Ask again now, and forget the backoff. What a Retry button and a pull to refresh mean. */
    fun retry() = kick.kick()

    val state: StateFlow<ScheduleState> =
        session
            .distinctUntilChanged()
            .flatMapLatest { current ->
                if (current is SessionState.SignedIn) poll() else flow { emit(ScheduleState.SignedOut) }
            }
            .stateIn(scope, SharingStarted.WhileSubscribed(SUBSCRIBER_GRACE_MS), ScheduleState.Loading)

    private fun poll(): Flow<ScheduleState> = flow {
        var lastGood: ScheduleReading? = null
        var lastGoodAtMs: Long? = null
        var failures = 0
        var slots: List<ScheduleSlot> = emptyList()
        var personas: List<Persona> = emptyList()
        var namesReadAt = 0L
        var polls = 0L

        while (true) {
            try {
                // The names first, and only when they are stale: a block with no label is a worse
                // answer than a block a moment late, and re-reading them every poll would be three
                // requests a minute for a list an operator edits by hand.
                if (polls == 0L || polls - namesReadAt >= NAMES_EVERY_POLLS) {
                    slots = readSlots()
                    personas = readPersonas()
                    namesReadAt = polls
                }

                val reading = ScheduleReading(now = readCurrent(), slots = slots, personas = personas)
                lastGood = reading
                lastGoodAtMs = nowEpochMs()
                failures = 0
                emit(ScheduleState.Answered(reading))
            } catch (error: Exception) {
                // The last good reading is carried rather than discarded, exactly as the now-playing
                // poll carries its own: one failed read is ordinary, and blanking the screen would
                // make every hiccup look like the station losing its schedule.
                failures += 1
                emit(ScheduleState.Unreachable(lastGood, lastGoodAtMs))
            }

            polls += 1
            if (kick.awaitOrDelay(intervalFor(failures))) failures = 0
        }
    }

    /** Steady while it works, backing off while it does not — the same shape and bound as the now-playing poll. */
    private fun intervalFor(failures: Int): Long {
        if (failures == 0) return POLL_MS
        val backed = POLL_MS shl minOf(failures, MAX_DOUBLINGS)
        return minOf(backed, MAX_POLL_MS)
    }

    companion object {
        /** What the console polls `/schedule/current` at. A block boundary is not a thing to be first to know. */
        const val POLL_MS = 30_000L
        const val MAX_POLL_MS = 300_000L
        private const val MAX_DOUBLINGS = 4

        /** How many polls the slot and persona lists are good for: half an hour of them. */
        const val NAMES_EVERY_POLLS = 60L

        /** As long as the now-playing poll holds open, and for the same reasons. */
        const val SUBSCRIBER_GRACE_MS = 5_000L
    }
}
