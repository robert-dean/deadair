package com.maroonedsoftware.deadair.playback

import android.os.SystemClock
import android.util.Log
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player

/**
 * Writes why the audio stopped to logcat, under one tag, one line per event.
 *
 * `ReconnectPolicy` answers a player error by retrying, and said nothing about what the error was:
 * a listener reported the audio dropping several times on 2026-10-11, the phone's audio history
 * showed seven restarts and two stalls, and by the time anybody looked the log had rotated and the
 * exceptions were gone. So the two ways a listener hears a drop are written here in a form meant to
 * be grepped out of a long capture (`adb logcat -s deadair.playback`):
 *
 * - `error code=<name> (<int>) uri=<what was playing> causes=<chain>`, then the full stack, for a
 *   failure the player gave up on and the policy will retry.
 * - `stall` when playback that was running starts buffering, and `resumed after <ms>` when it plays
 *   again, which is a drop the listener hears without the player ever failing.
 */
class PlaybackLog(private val player: Player) : Player.Listener {
    /** When the current stall began, or `null` when playback is not stalled. */
    private var stalledAt: Long? = null
    private var ready = false

    override fun onPlayerError(error: PlaybackException) {
        val uri = player.currentMediaItem?.localConfiguration?.uri
        Log.w(TAG, "error code=${error.errorCodeName} (${error.errorCode}) uri=$uri causes=${causes(error)}", error)
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        when (playbackState) {
            Player.STATE_BUFFERING ->
                if (ready && player.playWhenReady && stalledAt == null) {
                    stalledAt = SystemClock.elapsedRealtime()
                    Log.i(TAG, "stall uri=${player.currentMediaItem?.localConfiguration?.uri}")
                }
            Player.STATE_READY -> {
                ready = true
                stalledAt?.let { Log.i(TAG, "resumed after ${SystemClock.elapsedRealtime() - it}ms") }
                stalledAt = null
            }
            // IDLE after an error or a stop, ENDED on a drop: whatever follows is a fresh start,
            // not the end of this stall, and the error line has already said what happened.
            else -> {
                ready = false
                stalledAt = null
            }
        }
    }

    private companion object {
        const val TAG = "deadair.playback"

        /** `Outer: message <- Inner: message`, so the cause that matters is on the grepped line. */
        fun causes(error: Throwable): String =
            generateSequence(error) { it.cause?.takeIf { cause -> cause !== it } }
                .take(6)
                .joinToString(" <- ") { "${it.javaClass.simpleName}: ${it.message}" }
    }
}
