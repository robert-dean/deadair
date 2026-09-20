package com.maroonedsoftware.deadair.nowplaying

import com.maroonedsoftware.deadair.net.Kick
import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.station.StationUrl
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

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
 *
 * **And it slows down when nobody can SEE it.** Stopping was only ever half the question, because
 * the case that costs a listener most is the one where the poll is right to run: an hour with the
 * phone in a pocket is an hour of a three-second poll, twelve hundred requests, none of them drawn
 * anywhere. Nothing is showing those readings then — the screen is off and the lock screen holds
 * whatever was last pushed to it — so a collector that is showing them to somebody takes them
 * through [watched] and gets the fast cadence, and everything else gets [UNWATCHED_POLL_MS]. What
 * still has to be current in between is the lock screen's metadata, and that is driven off the
 * audio's own ICY title rather than off this clock: see `NowPlayingGate`.
 *
 * **What this saves is CPU and requests, not radio time**, which is the opposite of the reason it
 * was written. Measured screen-off on a phone, against the same build without this: Wi-Fi sleep
 * time is 97% either way, because the stream itself never lets the radio idle; app-process CPU is
 * 18% lower. The station also answers a tenth as many requests and writes a tenth as many log
 * lines, which was always the other half of the argument. The full numbers are in
 * `apps/android/CLAUDE.md`.
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

    /**
     * How many collectors are showing these readings to a person.
     *
     * Counted rather than flagged because there is routinely more than one — a screen and the
     * service's own display-on subscription overlap across a rotation — and the first to leave
     * must not answer for the rest.
     */
    private val watchers = MutableStateFlow(0)

    /**
     * The readings, for something a person is actually looking at.
     *
     * Collecting this is what asks for the three-second cadence, and it asks for exactly as long
     * as the collection lasts, which is the same self-correcting arrangement `WhileSubscribed`
     * already uses one level down: there is no flag for a screen to set and forget to clear. A
     * screen collects this; `PlaybackConductor` collects [state], because it needs the readings
     * without being a reason to hurry.
     *
     * Subscribing also kicks, so a screen coming back to the front shows a current reading at once
     * instead of finishing out a wait begun while nobody was there.
     *
     * Shared with the same grace as [state] below it, for the same reason: a rotation is not a
     * screen leaving, and counting it as one would flap the cadence and spend a request saying so.
     * A `StateFlow` rather than a plain `Flow` so a screen can collect it without having to reach
     * for [state]'s current value to seed itself, which is a read Compose lint refuses on sight.
     */
    val watched: StateFlow<NowPlayingState> =
        state
            .onStart {
                watchers.update { it + 1 }
                kick.kick()
            }
            .onCompletion { watchers.update { it - 1 } }
            .stateIn(scope, SharingStarted.WhileSubscribed(SUBSCRIBER_GRACE_MS), NowPlayingState.Loading)

    /** Ask again now, and forget the backoff. What a Retry button means, and what an ICY title change means. */
    fun retry() = kick.kick()

    private fun poll(station: StationUrl): Flow<NowPlayingState> = flow {
        var lastGood: Reading? = null
        var failures = 0
        // Whatever asked for a reading before this loop existed is about to get one.
        kick.drain()

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
     *
     * The steady rate is whichever of the two cadences applies at the moment the wait begins, so a
     * screen that goes away mid-wait is answered on the next turn of the loop rather than never;
     * a screen that ARRIVES mid-wait does not have to wait at all, because subscribing kicks.
     */
    private fun intervalFor(failures: Int): Long {
        val base = if (watchers.value > 0) POLL_MS else UNWATCHED_POLL_MS
        if (failures == 0) return base
        val backed = base shl minOf(failures, MAX_DOUBLINGS)
        return minOf(backed, maxOf(MAX_POLL_MS, base))
    }

    companion object {
        /** Fast enough that a track change is noticed within a bar or two, which is what the console uses. */
        const val POLL_MS = 3_000L

        /**
         * The rate with nothing watching: ten times fewer requests for an hour of listening with
         * the screen off.
         *
         * A safety net rather than the thing that keeps the lock screen right — the ICY title does
         * that, and does it on the audio's own schedule. What it does still bound is the stretch of
         * cases ICY cannot cover: HLS, which carries none, and a record ENDING early under a sleep
         * timer armed for the end of this one, which now fires up to this much late. The display
         * coming on is a watcher, so neither is ever what somebody is looking at while it is wrong.
         */
        const val UNWATCHED_POLL_MS = 30_000L
        const val MAX_POLL_MS = 30_000L
        private const val MAX_DOUBLINGS = 5

        /**
         * How long polling survives losing its last collector. Long enough to cover a rotation or
         * the screen handing over to the service, short enough that backgrounding the app stops it.
         */
        const val SUBSCRIBER_GRACE_MS = 5_000L
    }
}
