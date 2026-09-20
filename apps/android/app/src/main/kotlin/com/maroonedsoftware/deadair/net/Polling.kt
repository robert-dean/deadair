package com.maroonedsoftware.deadair.net

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.withTimeoutOrNull

/**
 * A way to wake a poll loop before its interval is up.
 *
 * Every poll in this app backs off while the station is not answering, up to five minutes. That is
 * right for a station that is down and wrong for a listener who has just fixed their wifi and is
 * looking at "could not reach the station" with nothing to press. A kick ends the current wait
 * early and tells the loop to forget its failures, which is what a Retry button and a pull to
 * refresh both mean.
 *
 * One consumer per instance: a kick that lands while the loop is mid-fetch rather than waiting is
 * kept until the loop next asks, so a retry pressed during a slow request is not lost. Pure Kotlin,
 * so the loops that use it stay testable on virtual time.
 */
class Kick {
    private val kicks = MutableStateFlow(0)
    private var consumed = 0

    /** Wake the loop. Cheap, and safe to call from anywhere. */
    fun kick() {
        kicks.update { it + 1 }
    }

    /**
     * Forget any kick that arrived before now.
     *
     * For the top of a loop that is about to ask anyway. A kick is "ask now", and a loop whose
     * first act is to ask has already answered every one of them; without this, a subscriber that
     * kicks as it arrives (`NowPlayingRepository.watched`) makes a cold loop fetch twice in a row,
     * once for starting and once for the kick it has just satisfied.
     */
    fun drain() {
        consumed = kicks.value
    }

    /**
     * Wait for the interval, or until kicked, whichever comes first. Answers whether it was kicked,
     * which is the caller's cue to reset its backoff.
     */
    suspend fun awaitOrDelay(intervalMs: Long): Boolean {
        if (kicks.value != consumed) {
            consumed = kicks.value
            return true
        }
        val kicked = withTimeoutOrNull(intervalMs) { kicks.first { it != consumed } } != null
        consumed = kicks.value
        return kicked
    }
}
