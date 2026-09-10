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
        if (playWhenReady) return
        cancel()
        // A pause the listener pressed already stops through LivePlayer's pause-is-stop override.
        // These two reasons are pauses Media3 makes INTERNALLY (audio focus lost, headphones
        // unplugged) which never reach that override, so the socket (and the audience gate's
        // count of a listener) is released here instead.
        when (reason) {
            Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS,
            Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY,
            -> stop()
        }
    }

    override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
        // Suppressed playback (a transient focus loss with no pause, an unsuitable route, ...)
        // still holds a connected socket open for nobody, which the audience gate counts as a
        // listener the same as an unwanted pause does.
        if (playbackSuppressionReason == Player.PLAYBACK_SUPPRESSION_REASON_NONE) return
        cancel()
        stop()
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
