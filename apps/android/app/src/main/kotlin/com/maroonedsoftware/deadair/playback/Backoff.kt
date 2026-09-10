package com.maroonedsoftware.deadair.playback

/**
 * How long to wait before trying the stream again.
 *
 * Doubling from a second to half a minute. A stream that failed once may be a passing thing — a
 * segment that rolled off, a proxy restarting — and retrying immediately is right for that; one
 * that has failed six times is a station that is down, and a phone retrying every second is a
 * phone flattening its own battery against a server that is not there.
 *
 * It gives up eventually rather than retrying for the rest of the day, because a listener who
 * walked away from a stopped stream should not come back to a dead battery.
 */
class Backoff(
    private val firstMs: Long = 1_000,
    private val ceilingMs: Long = 30_000,
    private val giveUpAfterMs: Long = 5 * 60_000,
) {
    private var attempts = 0
    private var waitedMs = 0L

    /** The next wait, or `null` once this has been trying for longer than it is worth. */
    fun next(): Long? {
        if (waitedMs >= giveUpAfterMs) return null
        val wait = minOf(firstMs shl minOf(attempts, MAX_DOUBLINGS), ceilingMs)
        attempts += 1
        waitedMs += wait
        return wait
    }

    /** Called when the stream plays again, so the next failure starts from a second and not from thirty. */
    fun reset() {
        attempts = 0
        waitedMs = 0
    }

    /** Whether this has been trying for longer than it is worth, i.e. `next()` would answer `null`. */
    val exhausted: Boolean
        get() = waitedMs >= giveUpAfterMs

    private companion object {
        const val MAX_DOUBLINGS = 5
    }
}
