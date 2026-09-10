package com.maroonedsoftware.deadair.playback

import androidx.media3.common.PlaybackException
import androidx.media3.common.Player

/** Cancels whatever it was returned from scheduling. */
typealias Cancel = () -> Unit

/**
 * Decides whether and when to try the stream again, from the player's own events.
 *
 * Pure Kotlin: `schedule` is injected rather than a `Handler`, so this runs and is tested on the
 * JVM with no `android.*` import. One retry is ever pending: a fresh error cancels whatever was
 * already waiting, and `STATE_READY` cancels it outright, because a stream that recovered on its
 * own should not then be restarted a moment later.
 */
class ReconnectPolicy(
    private val backoff: Backoff,
    private val schedule: (Long, () -> Unit) -> Cancel,
    private val wantsPlay: () -> Boolean,
    private val reconnect: () -> Unit,
    private val stop: () -> Unit,
) : Player.Listener {
    private var pending: Cancel? = null

    override fun onPlayerError(error: PlaybackException) {
        retryLater()
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        when (playbackState) {
            // A stream that is playing has earned a fresh budget: the next failure should wait a
            // second, not wherever the last outage's backoff left off. Whatever was pending is now
            // moot.
            Player.STATE_READY -> {
                backoff.reset()
                cancel()
            }
            // A live stream never ends on purpose, so reaching ENDED is a drop like any other, not
            // a stream that finished normally.
            Player.STATE_ENDED -> retryLater()
        }
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        if (!playWhenReady) cancel()
    }

    /** Drop the pending retry, if there is one. */
    fun cancel() {
        pending?.invoke()
        pending = null
    }

    /** Try the stream again after a wait, for as long as that is worth doing. */
    private fun retryLater() {
        cancel()
        if (!wantsPlay()) return
        val wait = backoff.next() ?: return
        pending = schedule(wait) { if (wantsPlay()) reconnect() }
    }
}
