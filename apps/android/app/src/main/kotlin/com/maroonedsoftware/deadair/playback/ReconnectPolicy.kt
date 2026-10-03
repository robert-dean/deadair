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
 *
 * **With no network, a failure waits for one instead of spending the budget.** A phone in a lift or
 * a tunnel used to retry against nothing for five minutes and then stop, even when the signal came
 * back seconds later. Now a drop with no network retries nothing until [onNetwork] says one is up,
 * and then retries at once, from a fresh backoff: the failures before it were the missing network,
 * not the station. The wait has its own, longer limit ([offlineLimitMs]), after which it stops for
 * the same reason the budget does.
 *
 * **A stream held on one connection moves with the network.** An Icecast mount is a single socket,
 * bound to whichever network was the default when it connected, and a handover leaves it on the
 * old one: dead outright when wifi fades, or running on until Android tears the lingering mobile
 * network down. Waiting for it to fail cost up to the read timeout in silence, so a change of
 * network [restart]s it at once instead. HLS is a request per segment, each on the network of the
 * moment, and is left alone ([heldConnection]).
 */
class ReconnectPolicy(
    private val backoff: Backoff,
    private val schedule: (Long, () -> Unit) -> Cancel,
    private val wantsPlay: () -> Boolean,
    private val reconnect: () -> Unit,
    private val stop: () -> Unit,
    /** Connect again from scratch, for a stream that has not failed but is on the wrong network. */
    private val restart: () -> Unit = reconnect,
    /** Whether the stream rides one long connection, which a change of network leaves behind. */
    private val heldConnection: () -> Boolean = { true },
    private val offlineLimitMs: Long = OFFLINE_LIMIT_MS,
) : Player.Listener {
    private var pending: Cancel? = null

    /** Whether the phone has a network to reach the station over. Assumed until told otherwise. */
    private var online = true

    /** The last network the phone was on, kept through a spell with none, so a return can be told from a move. */
    private var lastNetwork: Long? = null

    /** The give-up timer of a drop that is waiting for the network to come back, or `null` when none is. */
    private var awaitingNetwork: Cancel? = null

    /**
     * The phone's default network, by an identity that tells one network from another, or `null`
     * for none.
     *
     * Losing it does nothing to a stream that is still playing out of its buffer: the player says
     * so itself when it fails, and only then is there a drop to hold. It does cancel a retry that
     * is already scheduled, which would otherwise fire against nothing and spend budget doing it.
     *
     * A DIFFERENT network than the last one, with or without a spell of none between them, is a
     * move: a scheduled retry is made now rather than at the end of its wait, and a held connection
     * that has not failed yet is restarted, because it is on a network that is going or gone. The
     * SAME network coming back is not a move, and a connection that survived the blip is left be.
     */
    fun onNetwork(network: Long?) {
        if (network == null) {
            if (!online) return
            online = false
            if (pending != null) {
                cancelRetry()
                waitForNetwork()
            }
            return
        }
        val moved = lastNetwork != null && network != lastNetwork
        val returned = !online
        lastNetwork = network
        online = true
        if (!moved && !returned) return

        val waiting = awaitingNetwork != null
        val retrying = pending != null
        cancel()
        if (!wantsPlay()) return
        when {
            waiting || retrying -> {
                backoff.reset()
                reconnect()
            }
            moved && heldConnection() -> restart()
        }
    }

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

    /** Drop the pending retry, if there is one, and stop waiting for the network. */
    fun cancel() {
        cancelRetry()
        awaitingNetwork?.invoke()
        awaitingNetwork = null
    }

    private fun cancelRetry() {
        pending?.invoke()
        pending = null
    }

    /**
     * Hold the drop until [onNetwork] reports a network, for at most [offlineLimitMs] from when the
     * wait began: a second error while already waiting does not start the limit again.
     */
    private fun waitForNetwork() {
        if (awaitingNetwork != null) return
        awaitingNetwork =
            schedule(offlineLimitMs) {
                awaitingNetwork = null
                if (wantsPlay()) stop()
            }
    }

    /** Try the stream again after a wait, for as long as that is worth doing. */
    private fun retryLater() {
        if (!wantsPlay()) {
            cancel()
            return
        }
        cancelRetry()
        if (!online) {
            waitForNetwork()
            return
        }
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
        pending =
            schedule(wait) {
                // Fired, so no longer pending: a network lost while this attempt connects is the
                // attempt's own failure to report, not a retry to hold back.
                pending = null
                if (wantsPlay()) reconnect()
            }
    }

    private companion object {
        /**
         * How long a drop waits for the network before stopping. Longer than the retry budget,
         * because waiting costs nothing (no request is made), and a stretch of underground between
         * two stations is longer than five minutes. Not for ever, because a station that starts
         * playing out of a pocket half an hour after it went quiet is a surprise, not a feature.
         */
        const val OFFLINE_LIMIT_MS = 15 * 60_000L
    }
}
