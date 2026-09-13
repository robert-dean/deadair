package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.nowplaying.Reading

/** Whether the station is set to stop by itself, and when. Deadlines are on the elapsed-realtime clock. */
sealed interface SleepState {
    data object Off : SleepState

    /** Stops at [deadlineMs]. */
    data class Until(val deadlineMs: Long) : SleepState

    /** Stops when the record on air ends. [deadlineMs] is `null` until a reading can say when that is. */
    data class AfterRecord(val deadlineMs: Long?) : SleepState
}

/** What a listener asked the timer for. */
sealed interface SleepRequest {
    data class Minutes(val minutes: Long) : SleepRequest

    data object AfterRecord : SleepRequest
}

/**
 * Stops the station after a while, or after the record on air, with the sound faded out first.
 *
 * It STOPS: `stop` is the player's own stop, never a pause, because a paused connection is still a
 * listener and the station would stay on air for five minutes for somebody asleep. And the volume is
 * put back afterwards, because the player keeps it across a stop and the next press of play would
 * otherwise be silent.
 *
 * **"After this record" waits for the listener, not the station.** A reading's `remainingMs` leads
 * what the listener hears by whatever the player has buffered, so the deadline is the reading's own
 * time plus what was left plus the buffer: stopping at the station's end of the record would cut the
 * last seconds of it off the listener's. It re-anchors on every reading of the same record, because
 * `remainingMs` does. When the record changes before the deadline (an operator's skip, a catalog
 * length that was wrong), the record is over, and the timer fires once the buffer has drained.
 *
 * Pure, like `ReconnectPolicy` and `NowPlayingGate` beside it: `schedule` and `now` are injected, so
 * this is a JVM test with no `android.*` in it. It lives in the service rather than the screen
 * because it has to fire with the activity gone, which is when somebody falling asleep has left it.
 */
class SleepTimer(
    private val schedule: (Long, () -> Unit) -> Cancel,
    private val now: () -> Long,
    private val fade: (Float) -> Unit,
    private val stop: () -> Unit,
    private val publish: (SleepState) -> Unit,
    private val fadeMs: Long = FADE_MS,
    private val fadeSteps: Int = FADE_STEPS,
) {
    var state: SleepState = SleepState.Off
        private set

    private var pending: Cancel? = null
    private var fading = false

    /** The record "after this record" is waiting out, by when it started; `null` once it is over. */
    private var waitingOut: Long? = null
    private var lastReading: Reading? = null
    private var lastBufferedMs = 0L

    fun arm(request: SleepRequest) {
        cancelPending()
        when (request) {
            is SleepRequest.Minutes -> {
                waitingOut = null
                set(SleepState.Until(now() + request.minutes * MINUTE_MS))
            }
            SleepRequest.AfterRecord -> {
                val track = lastReading?.nowPlaying?.track
                waitingOut = track?.startedAt
                set(SleepState.AfterRecord(deadlineFor(lastReading, lastBufferedMs)))
            }
        }
    }

    /** Turn it off, and put the sound back if it was already fading. */
    fun clear() {
        cancelPending()
        waitingOut = null
        if (fading) restoreVolume()
        if (state != SleepState.Off) set(SleepState.Off)
    }

    /** The player stopped for a reason of its own (a hand on Stop, a headset unplugged): the timer was for that session. */
    fun onStopped() = clear()

    /** A fresh reading, with how much audio the player is holding at that moment. */
    fun onPoll(reading: Reading?, bufferedMs: Long) {
        lastReading = reading
        lastBufferedMs = bufferedMs
        val current = state as? SleepState.AfterRecord ?: return
        val track = reading?.nowPlaying?.track
        val startedAt = waitingOut

        val deadline =
            when {
                // Already over: the deadline set when it ended stands.
                startedAt == null && current.deadlineMs != null -> return
                // Armed before any reading could say which record: this is the one.
                startedAt == null && track != null -> {
                    waitingOut = track.startedAt
                    deadlineFor(reading, bufferedMs)
                }
                startedAt == null -> return
                // The same record: re-anchor, since `remainingMs` does.
                track?.startedAt == startedAt -> deadlineFor(reading, bufferedMs) ?: current.deadlineMs
                // Something else is on air, or nothing is: the record is over for the station, and
                // is over for the listener once the buffer has played out.
                else -> {
                    waitingOut = null
                    now() + bufferedMs
                }
            }
        // Readings a few hundred milliseconds apart in their projection are the same deadline: moving
        // it on every poll would reschedule the fade under the listener for nothing.
        val previous = current.deadlineMs
        if (deadline != null && (previous == null || kotlin.math.abs(deadline - previous) >= ANCHOR_TOLERANCE_MS)) {
            cancelPending()
            set(SleepState.AfterRecord(deadline))
        }
    }

    private fun deadlineFor(reading: Reading?, bufferedMs: Long): Long? {
        val remaining = reading?.nowPlaying?.track?.remainingMs ?: return null
        return reading.readAtMs + remaining + bufferedMs
    }

    /** Record the new state, tell whoever shows it, and schedule what it now means. */
    private fun set(next: SleepState) {
        state = next
        publish(next)
        val deadline =
            when (next) {
                SleepState.Off -> null
                is SleepState.Until -> next.deadlineMs
                is SleepState.AfterRecord -> next.deadlineMs
            } ?: return
        // A deadline moved out of the fade window puts the sound back.
        if (fading && deadline - now() > fadeMs) restoreVolume()
        pending = schedule((deadline - fadeMs - now()).coerceAtLeast(0)) { fadeStep(deadline) }
    }

    /** One step down, then the next, then the stop at the deadline itself. */
    private fun fadeStep(deadline: Long) {
        val left = deadline - now()
        if (left <= 0) {
            fire()
            return
        }
        fading = true
        fade((left.toFloat() / fadeMs).coerceIn(0f, 1f))
        pending = schedule(minOf(fadeMs / fadeSteps, left)) { fadeStep(deadline) }
    }

    private fun fire() {
        pending = null
        waitingOut = null
        state = SleepState.Off
        publish(SleepState.Off)
        stop()
        restoreVolume()
    }

    /** Drop what is scheduled. The volume is left where it is: a deadline re-set mid-fade carries on from there. */
    private fun cancelPending() {
        pending?.invoke()
        pending = null
    }

    private fun restoreVolume() {
        fading = false
        fade(1f)
    }

    companion object {
        const val FADE_MS = 10_000L
        const val FADE_STEPS = 20
        private const val MINUTE_MS = 60_000L
        private const val ANCHOR_TOLERANCE_MS = 1_000L
    }
}
