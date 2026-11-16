package com.maroonedsoftware.deadair.playback

import androidx.media3.common.PlaybackException
import androidx.media3.common.Player

/** Cancels whatever it was returned from scheduling. */
typealias Cancel = () -> Unit

/**
 * A decision [ReconnectPolicy] made, for the playback journal. The policy acts on the player
 * without leaving any other trace, so a restart on a network change was invisible after the fact:
 * no error, no stall, just a second of silence the listener heard.
 */
sealed interface ReconnectNote {
    /** One line for the journal. */
    val line: String

    /** The default network changed under a stream that had not failed, so it was connected again on the new one. */
    data object Restarted : ReconnectNote {
        override val line = "policy restart: the network moved"
    }

    /** A drop that was waiting or retrying was tried at once, because a network arrived. */
    data object Reconnected : ReconnectNote {
        override val line = "policy reconnect: a network arrived"
    }

    data class RetryIn(val waitMs: Long) : ReconnectNote {
        override val line = "policy retry in ${waitMs}ms"
    }

    data object Retrying : ReconnectNote {
        override val line = "policy retry now"
    }

    /** A drop with no network, held until one comes back. */
    data object AwaitingNetwork : ReconnectNote {
        override val line = "policy waiting for a network"
    }

    /** An HLS stream fell behind the playlist and was moved to its live edge, spending no retry. */
    data object ToLiveEdge : ReconnectNote {
        override val line = "policy jump to the live edge"
    }

    data object GaveUpRetrying : ReconnectNote {
        override val line = "policy stop: out of retries"
    }

    data object GaveUpWaiting : ReconnectNote {
        override val line = "policy stop: no network for too long"
    }

    /** Another app held the audio for longer than a voice note or a short video, so the stream was released. */
    data object GaveUpHeld : ReconnectNote {
        override val line = "policy stop: held by another app for too long"
    }

    /** A hold long enough to leave the buffer behind the air ended, so playback went back to live. */
    data object BackToLive : ReconnectNote {
        override val line = "policy jump to the live edge: held by another app"
    }
}

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
 * **A stream moves with the network.** An Icecast mount is a single socket, bound to whichever
 * network was the default when it connected, and a handover leaves it on the old one: dead outright
 * when wifi fades, or running on until Android tears the lingering mobile network down. Waiting for
 * it to fail cost up to the read timeout in silence, so a change of network [restart]s it at once
 * instead. HLS is restarted too, although it is a request per segment: a request already in flight
 * when wifi goes is on the old network all the same, and so is a kept-alive connection the next one
 * reuses. Left alone, a phone leaving the house went eighteen seconds without noticing, failed on
 * the read timeout, and dropped its buffer before the retry fetched a new one (measured 2026-10-09).
 *
 * **Behind the live window is not a failure of the connection.** An HLS playlist slides on, and a
 * player that stalled long enough finds the segments it wanted gone: `ERROR_CODE_BEHIND_LIVE_WINDOW`,
 * twice in the journal on 2026-10-21. A retry prepares the same position again, which is the one
 * that has gone; what fixes it is the live edge, so the policy calls [toLiveEdge] at once and
 * spends nothing from the backoff. Falling behind AGAIN within [LIVE_EDGE_COOLDOWN_MS] means the
 * edge was not the problem (the connection is), and that one is retried like any other failure,
 * so a stream that cannot keep up never jumps in a loop.
 */
class ReconnectPolicy(
    private val backoff: Backoff,
    private val schedule: (Long, () -> Unit) -> Cancel,
    private val wantsPlay: () -> Boolean,
    private val reconnect: () -> Unit,
    private val stop: () -> Unit,
    /** Connect again from scratch, for a stream that has not failed but is on the wrong network. */
    private val restart: () -> Unit = reconnect,
    /** Play again from the live edge, for a stream that fell behind the live window. */
    private val toLiveEdge: () -> Unit = reconnect,
    private val offlineLimitMs: Long = OFFLINE_LIMIT_MS,
    /** Told each decision as it is made, for the playback journal. Decides nothing. */
    private val note: (ReconnectNote) -> Unit = {},
) : Player.Listener {
    private var pending: Cancel? = null

    /** The give-up timer of a transient audio-focus loss, or `null` when playback is not held by one. */
    private var suppressed: Cancel? = null

    /** The timer that marks the current hold as [heldLong], or `null` when there is no hold or it already has. */
    private var holding: Cancel? = null

    /** Whether the current transient audio-focus loss has lasted [STALE_HOLD_MS], so its buffer is behind the air. */
    private var heldLong = false

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
     * move: a scheduled retry is made now rather than at the end of its wait, and a stream
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
        cancelPending()
        if (!wantsPlay()) return
        when {
            waiting || retrying -> {
                backoff.reset()
                note(ReconnectNote.Reconnected)
                reconnect()
            }
            moved -> {
                note(ReconnectNote.Restarted)
                restart()
            }
        }
    }

    /** Whether a jump to the live edge was made within [LIVE_EDGE_COOLDOWN_MS]. */
    private var jumpedRecently = false

    override fun onPlayerError(error: PlaybackException) {
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && !jumpedRecently && online && wantsPlay()) {
            cancelRetry()
            jumpedRecently = true
            schedule(LIVE_EDGE_COOLDOWN_MS) { jumpedRecently = false }
            note(ReconnectNote.ToLiveEdge)
            toLiveEdge()
            return
        }
        retryLater()
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        when (playbackState) {
            // A stream that is playing has earned a fresh budget: the next failure should wait a
            // second, not wherever the last outage's backoff left off. Whatever was pending is now
            // moot.
            Player.STATE_READY -> {
                backoff.reset()
                cancelPending()
            }
            // A live stream never ends on purpose, so reaching ENDED is a drop like any other, not
            // a stream that finished normally.
            Player.STATE_ENDED -> retryLater()
        }
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        if (playWhenReady) return
        cancelPending()
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
        val wasHeldLong = heldLong
        cancelHold()
        when (playbackSuppressionReason) {
            // A hold that ended. Media3 resumes from the position it held, and the player kept its
            // buffer through the hold, so after more than a moment that position is behind the air:
            // the lock screen names the record on air while the listener hears an older one, and an
            // Icecast mount that stopped reading may have been dropped by the server meanwhile. So a
            // long hold goes back to live, as a stream that fell behind the live window does; a
            // notification's second or two is left to play on.
            Player.PLAYBACK_SUPPRESSION_REASON_NONE -> {
                if (wasHeldLong && online && wantsPlay()) {
                    note(ReconnectNote.BackToLive)
                    toLiveEdge()
                }
                return
            }
            // A transient audio-focus loss (a notification, a short video, a nav prompt) is Media3
            // holding playback, and it resumes on its own when focus comes back. A loss that only
            // asks to duck is a lower volume and never reaches here. Stopping here turned that resume
            // into a permanent stop: the station went quiet whenever another app made a sound, and
            // stayed quiet. So it is given [TRANSIENT_SUPPRESSION_LIMIT_MS] to come back, and only a
            // loss that outlasts it (a phone call, say) releases the socket the audience gate counts
            // as a listener.
            Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS -> {
                holding = schedule(STALE_HOLD_MS) {
                    holding = null
                    heldLong = true
                }
                suppressed =
                    schedule(TRANSIENT_SUPPRESSION_LIMIT_MS) {
                        suppressed = null
                        cancel()
                        if (wantsPlay()) {
                            note(ReconnectNote.GaveUpHeld)
                            stop()
                        }
                    }
                return
            }
        }
        // Any other suppression (an unsuitable audio route, say) holds a socket open for nobody with
        // no resume coming, which the audience gate counts as a listener the same as an unwanted
        // pause does, so it is released at once.
        cancelPending()
        stop()
    }

    /**
     * Drop the pending retry, if there is one, stop waiting for the network, and forget any hold by
     * another app: whoever calls this is starting the stream over, and a give-up timer left from
     * the stream before would stop the new one.
     */
    fun cancel() {
        cancelPending()
        cancelHold()
    }

    /**
     * Drop the pending retry and stop waiting for the network, leaving a hold by another app be: a
     * stream that recovers or moves network while it is held is still held, and still owes a stop
     * if the hold outlasts [TRANSIENT_SUPPRESSION_LIMIT_MS].
     */
    private fun cancelPending() {
        cancelRetry()
        awaitingNetwork?.invoke()
        awaitingNetwork = null
    }

    private fun cancelHold() {
        suppressed?.invoke()
        suppressed = null
        holding?.invoke()
        holding = null
        heldLong = false
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
        note(ReconnectNote.AwaitingNetwork)
        awaitingNetwork =
            schedule(offlineLimitMs) {
                awaitingNetwork = null
                if (wantsPlay()) {
                    note(ReconnectNote.GaveUpWaiting)
                    stop()
                }
            }
    }

    /** Try the stream again after a wait, for as long as that is worth doing. */
    private fun retryLater() {
        if (!wantsPlay()) {
            cancelPending()
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
            note(ReconnectNote.GaveUpRetrying)
            stop()
            return
        }
        note(ReconnectNote.RetryIn(wait))
        pending =
            schedule(wait) {
                // Fired, so no longer pending: a network lost while this attempt connects is the
                // attempt's own failure to report, not a retry to hold back.
                pending = null
                if (wantsPlay()) {
                    note(ReconnectNote.Retrying)
                    reconnect()
                }
            }
    }

    private companion object {
        /** How long after a jump to the live edge falling behind again is a failure rather than drift. */
        const val LIVE_EDGE_COOLDOWN_MS = 30_000L

        /**
         * How long a drop waits for the network before stopping. Longer than the retry budget,
         * because waiting costs nothing (no request is made), and a stretch of underground between
         * two stations is longer than five minutes. Not for ever, because a station that starts
         * playing out of a pocket half an hour after it went quiet is a surprise, not a feature.
         */
        const val OFFLINE_LIMIT_MS = 15 * 60_000L

        /**
         * How long a transient audio-focus loss may hold playback before the stream is stopped. Long
         * enough for a voice note or a short video, short enough that a phone call does not keep the
         * station airing to a socket nobody is hearing.
         */
        const val TRANSIENT_SUPPRESSION_LIMIT_MS = 2 * 60_000L

        /**
         * How long a transient audio-focus loss may hold playback before resuming from the held
         * position would leave the listener noticeably behind the air. A notification sound is over
         * well inside it; a voice note is not.
         */
        const val STALE_HOLD_MS = 10_000L
    }
}
