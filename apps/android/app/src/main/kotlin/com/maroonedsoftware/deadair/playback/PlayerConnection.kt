package com.maroonedsoftware.deadair.playback

import android.content.ComponentName
import android.content.Context
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.MoreExecutors
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the screen needs to know about the player. */
data class PlayerUiState(
    val playing: Boolean = false,
    val buffering: Boolean = false,
    /** What the listener asked for, which is not the same as what is coming out yet. */
    val requested: Boolean = false,
)

/**
 * The screen's handle on the playback service.
 *
 * A `MediaController` rather than a reference to the player, so the screen and the notification and
 * a car stereo are all driving the same session through the same interface — and so the service
 * outlives the activity, which is the whole point of it.
 */
class PlayerConnection(private val context: Context) {
    private var controller: MediaController? = null
    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()

    private val listener =
        object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) {
                _state.value =
                    PlayerUiState(
                        playing = player.isPlaying,
                        buffering = player.playbackState == Player.STATE_BUFFERING,
                        requested = player.playWhenReady,
                    )
            }
        }

    fun connect() {
        if (controller != null) return
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener(
            {
                controller = future.get().also { it.addListener(listener) }
                _state.value = _state.value.copy(requested = controller?.playWhenReady ?: false)
            },
            MoreExecutors.directExecutor(),
        )
    }

    fun release() {
        controller?.let {
            it.removeListener(listener)
            it.release()
        }
        controller = null
    }

    fun play() {
        controller?.play()
    }

    /**
     * Stop, not pause: `LivePlayer` maps one onto the other, and this says which it means.
     *
     * The state is reset here for the frame before the player's own events arrive; `LivePlayer`
     * clears `playWhenReady` on stop, so those events agree rather than putting the Stop button
     * back, which is what they did.
     */
    fun stop() {
        controller?.stop()
        _state.value = _state.value.copy(requested = false, playing = false, buffering = false)
    }
}
