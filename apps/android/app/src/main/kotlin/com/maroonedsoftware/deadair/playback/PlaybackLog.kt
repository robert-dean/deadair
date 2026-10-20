package com.maroonedsoftware.deadair.playback

import android.net.Uri
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player

/**
 * Writes why the audio stopped to logcat, under one tag, one line per event, and the same line to
 * the [journal] that outlives logcat (see `PlaybackJournal`).
 *
 * `ReconnectPolicy` answers a player error by retrying, and said nothing about what the error was:
 * a listener reported the audio dropping several times on 2026-10-11, the phone's audio history
 * showed seven restarts and two stalls, and by the time anybody looked the log had rotated and the
 * exceptions were gone. So the two ways a listener hears a drop are written here in a form meant to
 * be grepped out of a long capture (`adb logcat -s deadair.playback`):
 *
 * - `error code=<name> (<int>) uri=<what was playing> causes=<chain>`, then the full stack, for a
 *   failure the player gave up on and the policy will retry. The stack goes to logcat only.
 * - `stall` when playback that was running starts buffering, and `resumed after <ms>` when it plays
 *   again, which is a drop the listener hears without the player ever failing.
 *
 * The journal also gets `play`, `stop reason=<why>` and `item uri=<what is playing>`, which logcat
 * does not: a journal read a day later needs to say where each listening session began and ended,
 * or a stall cannot be told from the listener pressing Stop. [SessionLines] decides which of those
 * are new.
 *
 * The address is written without its query or fragment, because the journal is a file somebody
 * shares and the address is the one thing in it that could carry more than a place.
 */
class PlaybackLog(private val player: Player, private val journal: (String) -> Unit = {}) : Player.Listener {
    /** When the current stall began, or `null` when playback is not stalled. */
    private var stalledAt: Long? = null
    private var ready = false
    private val session = SessionLines()

    override fun onPlayerError(error: PlaybackException) {
        write(Log.WARN, "error code=${error.errorCodeName} (${error.errorCode}) uri=${playing()} causes=${causes(error)}", error)
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
        when (playbackState) {
            Player.STATE_BUFFERING ->
                if (ready && player.playWhenReady && stalledAt == null) {
                    stalledAt = SystemClock.elapsedRealtime()
                    write(Log.INFO, "stall uri=${playing()}")
                }
            Player.STATE_READY -> {
                ready = true
                stalledAt?.let { write(Log.INFO, "resumed after ${SystemClock.elapsedRealtime() - it}ms") }
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

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        session.onPlayWhenReady(playWhenReady, stopReason(reason))?.let(journal)
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        session.onItem(playing()?.toString())?.let(journal)
    }

    /** A line from beside the player (the reconnect policy's decisions), written the same two ways. */
    fun note(line: String) = write(Log.INFO, line)

    private fun playing(): Uri? = player.currentMediaItem?.localConfiguration?.uri?.buildUpon()?.clearQuery()?.fragment(null)?.build()

    private fun write(priority: Int, line: String, error: Throwable? = null) {
        if (priority == Log.WARN) Log.w(TAG, line, error) else Log.i(TAG, line)
        journal(line)
    }

    companion object {
        /** The one logcat tag for everything that says why the audio stopped, wherever it is written from. */
        const val TAG = "deadair.playback"

        /** `Outer: message <- Inner: message`, so the cause that matters is on the grepped line. */
        private fun causes(error: Throwable): String =
            generateSequence(error) { it.cause?.takeIf { cause -> cause !== it } }
                .take(6)
                .joinToString(" <- ") { "${it.javaClass.simpleName}: ${it.message}" }

        private fun stopReason(reason: Int): String =
            when (reason) {
                Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST -> "listener"
                Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS -> "audio-focus"
                Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY -> "headphones-unplugged"
                Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE -> "remote"
                Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM -> "ended"
                Player.PLAY_WHEN_READY_CHANGE_REASON_SUPPRESSED_TOO_LONG -> "suppressed-too-long"
                else -> "$reason"
            }
    }
}
