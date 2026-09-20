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
 *
 * Running out of budget STOPS the player rather than quietly standing down; see `retryLater`.
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
        val wait = backoff.next()
        // Out of budget. Stopping rather than merely standing down, because `playWhenReady` is
        // what the rest of the app reads as "somebody is listening": ExoPlayer leaves it standing
        // through a failure, so a policy that only stopped RETRYING left a player that still
        // wanted to play, a notification still offering Stop, and — the expensive part —
        // `PlaybackConductor`'s poll collecting `/nowplaying` every three seconds for a stream it
        // had already given up on, for as long as the listener left it. The poll backs off only
        // when the POLL fails, so a station whose mount has lost its source while the API goes on
        // answering is the bad case: the retries end after five minutes and the requests do not
        // end at all.
        if (wait == null) {
            stop()
            return
        }
        pending = schedule(wait) { if (wantsPlay()) reconnect() }
    }
}
