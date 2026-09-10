package com.maroonedsoftware.deadair.playback

import androidx.annotation.OptIn
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import java.util.concurrent.CopyOnWriteArrayList

/**
 * A live stream has no pause, so this makes stop the only way to interrupt it.
 *
 * Two reasons, and neither is tidiness. A paused Icecast socket keeps buffering, so resuming plays
 * audio from minutes ago rather than what is on air — the listener is quietly moved off the live
 * edge with no way back. And a held-open connection keeps counting as an audience, so a station in
 * `audience` air mode goes on broadcasting to somebody who paused it and walked away.
 *
 * `stop()` keeps the media item, so `play()` from idle prepares again and returns to the live edge,
 * which is what a listener means by pressing play on a radio.
 *
 * Every seek command is withdrawn as well. The notification and any Bluetooth head unit build
 * their controls from the available commands, so this is what stops a car stereo from offering a
 * next-track button that could never do anything. The one exception is the NEXT control, which
 * carries the operator's Skip; see `canSkip`.
 */
// `ForwardingPlayer` is unstable API in Media3 and there is no stable equivalent: wrapping a
// player to change what its commands MEAN is the whole point of this class. Opted into here rather
// than repo-wide, so the next unstable API somebody reaches for still has to say so.
@OptIn(UnstableApi::class)
class LivePlayer(player: Player, private val onSkip: () -> Unit = {}) : ForwardingPlayer(player) {
    /**
     * Whether the head unit's next control is offered, and means the operator's Skip.
     *
     * Set from the signed-in role, so the button appears when the station calls this account its
     * operator and goes away when it stops doing so. Read and written on the application thread,
     * which is where a `Player` is touched and where the collector that sets it runs.
     *
     * Not gated on there being anything to skip. The screen's own Skip is, because it has the
     * transport reading in front of it; the playback service deliberately collects none of that,
     * and starting a two-second poll to grey out a steering-wheel button would cost every listener
     * something to save an operator one refusal.
     *
     * Set through `setCanSkip`, never directly, because changing it has to be ANNOUNCED.
     */
    var canSkip: Boolean = false
        private set

    /**
     * Every listener attached to this player, kept because the command set is this class's own.
     *
     * `ForwardingPlayer` hands listeners to the wrapped player, and the wrapped player fires
     * `onAvailableCommandsChanged` for changes to ITS commands. The subtraction this class performs
     * on top is invisible to it, so a session told once at construction believed that answer
     * forever: measured, the next control stayed absent from the media session's actions however
     * the role changed. Holding the listeners is what lets the change be announced.
     */
    private val listeners = CopyOnWriteArrayList<Player.Listener>()

    override fun addListener(listener: Player.Listener) {
        listeners += listener
        super.addListener(listener)
    }

    override fun removeListener(listener: Player.Listener) {
        listeners -= listener
        super.removeListener(listener)
    }

    /** Offer or withdraw the next control, and tell everything that draws one. */
    fun setCanSkip(value: Boolean) {
        if (canSkip == value) return
        canSkip = value

        val commands = availableCommands
        listeners.forEach { it.onAvailableCommandsChanged(commands) }
    }

    /**
     * The next control, which is not a seek.
     *
     * A head unit sends this as the same AVRCP forward that means "next track" everywhere else,
     * and here it ends the record on air for everybody listening. Nothing when the account cannot
     * skip, which is also when the command is not advertised, so this is belt and braces rather
     * than a second gate.
     */
    override fun seekToNext() {
        if (canSkip) onSkip()
    }

    override fun pause() {
        stop()
    }

    override fun setPlayWhenReady(playWhenReady: Boolean) {
        if (playWhenReady) play() else stop()
    }

    override fun play() {
        // ENDED is a stream that dropped rather than one that finished (a live stream never ends
        // on purpose) so play() has to prepare from there just as it does from IDLE.
        if (playbackState == Player.STATE_IDLE || playbackState == Player.STATE_ENDED) prepare()
        super.play()
    }

    /**
     * Stop, and say so.
     *
     * ExoPlayer's `stop()` moves to idle but leaves `playWhenReady` standing, which is right for a
     * player that might be told to resume and wrong for a radio that was switched off: the screen
     * reads "what the listener asked for" off `playWhenReady`, so a stopped stream kept drawing a
     * Stop button until the app was relaunched. `super.setPlayWhenReady`, because this class's own
     * override maps `false` back onto `stop()`.
     */
    override fun stop() {
        super.stop()
        super.setPlayWhenReady(false)
    }

    /**
     * The next control has to be ADDED, not merely left alone.
     *
     * ExoPlayer offers a next only when there is a next ITEM, and a live stream is one item for as
     * long as it plays, so the command was never in the set this class subtracts from: withdrawing
     * less from nothing yielded nothing, measured. What is being offered is the STATION's Skip
     * rather than the player's, so `seekToNext` above never reaches the wrapped player and its
     * empty playlist does not matter.
     */
    override fun getAvailableCommands(): Player.Commands =
        super.getAvailableCommands()
            .buildUpon()
            .removeAll(*withdrawnCommands(canSkip))
            .addIf(Player.COMMAND_SEEK_TO_NEXT, canSkip)
            .build()

    override fun isCommandAvailable(command: Int): Boolean =
        when {
            command == Player.COMMAND_SEEK_TO_NEXT -> canSkip
            command in withdrawnCommands(canSkip) -> false
            else -> super.isCommandAvailable(command)
        }

    private companion object {
        private operator fun IntArray.contains(value: Int): Boolean = any { it == value }
    }
}
