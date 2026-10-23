package com.maroonedsoftware.deadair.playback

/**
 * How long the listener heard nothing, from the moment the audio stopped to the moment it played
 * again, whatever happened in between.
 *
 * `PlaybackLog` used to time a stall only: buffering after playback had been running, ended by the
 * next ready state. A failure took the other road, through an error, the player going idle, a
 * retry or a restart on another network, and a fresh start that never counts as the end of a
 * stall, so it was never timed at all. The journal from 2026-10-21 has a stuck stream at 17:28:54,
 * a restart at 17:29:04, and nothing after them saying when the audio came back. So a spell starts
 * at a stall, a drop or an error, whichever comes first, lasts through every retry and restart,
 * ends at the next ready state, and is forgotten when the listener stops.
 *
 * A stuck stream is reported by the player only after [STUCK_MS] without progress, so the silence
 * began that long before the error, and the line says so rather than quietly adding it in.
 *
 * Pure, with times passed in, so the JVM tests drive it.
 */
class QuietSpell {
    private var since: Long? = null
    private var stuck = false

    /** Whether the audio is known to be silent right now. */
    val active: Boolean
        get() = since != null

    /** Playback that was running has started buffering, or a live stream has ended. */
    fun onStall(atMs: Long) {
        if (since == null) since = atMs
    }

    /** The player failed while the listener [wantsPlay]; [isStuck] for a stuck-playing timeout. */
    fun onError(atMs: Long, wantsPlay: Boolean, isStuck: Boolean) {
        if (!wantsPlay) return
        if (since == null) since = atMs
        if (isStuck) stuck = true
    }

    /** The player is ready. The line for the journal when this ends a spell, or `null` when there was none. */
    fun onReady(atMs: Long): String? {
        val start = since ?: return null
        val line = "resumed after ${atMs - start}ms" + if (stuck) ", after ${STUCK_MS}ms stuck before the error" else ""
        forget()
        return line
    }

    /** The listener stopped: whatever silence follows is theirs, not a drop. */
    fun onStopped() = forget()

    private fun forget() {
        since = null
        stuck = false
    }

    companion object {
        /** How long ExoPlayer lets playback make no progress before calling it stuck. */
        const val STUCK_MS = 10_000L
    }
}
