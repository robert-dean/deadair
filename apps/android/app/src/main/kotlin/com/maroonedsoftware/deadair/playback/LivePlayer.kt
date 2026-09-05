package com.maroonedsoftware.deadair.playback

import androidx.annotation.OptIn
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

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
 * Every seek and skip command is withdrawn as well. The notification and any Bluetooth head unit
 * build their controls from the available commands, so this is what stops a car stereo from
 * offering a next-track button that could never do anything.
 */
// `ForwardingPlayer` is unstable API in Media3 and there is no stable equivalent: wrapping a
// player to change what its commands MEAN is the whole point of this class. Opted into here rather
// than repo-wide, so the next unstable API somebody reaches for still has to say so.
@OptIn(UnstableApi::class)
class LivePlayer(player: Player) : ForwardingPlayer(player) {
    override fun pause() {
        stop()
    }

    override fun setPlayWhenReady(playWhenReady: Boolean) {
        if (playWhenReady) play() else stop()
    }

    override fun play() {
        if (playbackState == Player.STATE_IDLE) prepare()
        super.play()
    }

    override fun getAvailableCommands(): Player.Commands =
        super.getAvailableCommands().buildUpon().removeAll(*WITHDRAWN).build()

    override fun isCommandAvailable(command: Int): Boolean = command !in WITHDRAWN && super.isCommandAvailable(command)

    private companion object {
        /** Nothing that implies a position or a queue, because a live stream has neither. */
        val WITHDRAWN =
            intArrayOf(
                Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
                Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_PREVIOUS,
                Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_NEXT,
                Player.COMMAND_SEEK_TO_MEDIA_ITEM,
                Player.COMMAND_SEEK_BACK,
                Player.COMMAND_SEEK_FORWARD,
                Player.COMMAND_SET_SPEED_AND_PITCH,
            )

        private operator fun IntArray.contains(value: Int): Boolean = any { it == value }
    }
}
