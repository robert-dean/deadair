package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.net.Kick
import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.station.StationUrl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * What the station is playing, polled.
 *
 * A poll and not a push, because the API offers nothing else: there is no SSE and no WebSocket
 * anywhere in it, and `/nowplaying` answers out of memory with no database work, so being asked
 * every few seconds costs the station nothing. The console polls its own status on the same
 * interval for the same reason.
 *
 * **The polling stops on its own when nobody is looking.** `WhileSubscribed` means the loop runs
 * only while something collects this — the screen while it is resumed, the playback service while
 * it is playing — so an app in the background with the player stopped makes no requests at all.
 * That matters more here than it usually would: a request is not just battery, it is a line in the
 * station's log and a listener the station may count.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NowPlayingRepository(
    settings: Flow<ListenerSettings>,
    /**
     * One ask of one station. A function rather than the SDK itself, because what this class is
     * FOR is the policy — how often, what to do when it fails, when to stop — and none of that
     * needs an HTTP client to be exercised. The SDK's own behaviour is covered where it belongs,
     * in `StationProbeTest` and `NowPlayingDecodeTest`.
     */
    private val fetch: suspend (StationUrl) -> NowPlaying,
    private val elapsedMs: () -> Long,
    scope: CoroutineScope,
) {
    val state: StateFlow<NowPlayingState> =
        settings
            .map { it.station }
            // Only the station matters to the poll; changing the FORMAT restarts the player and
            // must not restart this, which would throw away a good reading for nothing.
            .distinctUntilChanged()
            .flatMapLatest { station -> if (station == null) flow { emit(NowPlayingState.Loading) } else poll(station) }
            .stateIn(scope, SharingStarted.WhileSubscribed(SUBSCRIBER_GRACE_MS), NowPlayingState.Loading)

    private val kick = Kick()

    /** Ask again now, and forget the backoff. What a Retry button means. */
    fun retry() = kick.kick()

    private fun poll(station: StationUrl): Flow<NowPlayingState> = flow {
        var lastGood: Reading? = null
        var failures = 0

        while (true) {
            try {
                val reading = Reading(fetch(station), elapsedMs())
                lastGood = reading
                failures = 0
                emit(NowPlayingState.Answered(reading))
            } catch (error: Exception) {
                // The last good reading is carried rather than discarded. One failed poll is
                // ordinary — a phone changing network, a tunnel reconnecting — and blanking the
                // screen would make every hiccup look like the station going away.
                failures += 1
                emit(NowPlayingState.Unreachable(lastGood))
            }
            // A kick ends the wait early and is a listener saying "try now", so the backoff goes
            // with it: the next failure starts the doubling again from the steady interval.
            if (kick.awaitOrDelay(intervalFor(failures))) failures = 0
        }
    }

    /**
     * How long to wait before asking again.
     *
     * Steady while it is working, and backing off while it is not, up to half a minute. A station
     * that is down stays down for longer than three seconds, and a client hammering it across a
     * reconnect is a client making the outage worse.
     */
    private fun intervalFor(failures: Int): Long {
        if (failures == 0) return POLL_MS
        val backed = POLL_MS shl minOf(failures, MAX_DOUBLINGS)
        return minOf(backed, MAX_POLL_MS)
    }

    companion object {
        /** Fast enough that a track change is noticed within a bar or two, which is what the console uses. */
        const val POLL_MS = 3_000L
        const val MAX_POLL_MS = 30_000L
        private const val MAX_DOUBLINGS = 5

        /**
         * How long polling survives losing its last collector. Long enough to cover a rotation or
         * the screen handing over to the service, short enough that backgrounding the app stops it.
         */
        const val SUBSCRIBER_GRACE_MS = 5_000L
    }
}
