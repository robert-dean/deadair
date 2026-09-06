package com.maroonedsoftware.deadair.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.maroonedsoftware.deadair.R

/**
 * The stock media notification, with a stop glyph where the pause glyph would be.
 *
 * `LivePlayer` already makes pause MEAN stop, so the button did the right thing and said the wrong
 * one: a listener saw a pause symbol on a radio that cannot pause. The central slot cannot be given
 * a stop button directly while `COMMAND_PLAY_PAUSE` is still offered, and it has to be — a
 * Bluetooth head unit's pause key is a play/pause command, and withdrawing the command would leave
 * it doing nothing. So the button keeps the play/pause command and takes the stop icon and name.
 *
 * Where this shows: Android 12 and earlier, Wear, and anything else that draws the NOTIFICATION's
 * actions. Android 13 and later draw the media control from the session's playback state instead
 * and ignore the notification's actions, so there the system still draws its own pause glyph while
 * playing — and pressing it stops, measured: the session goes to `NONE`, not `PAUSED`, and the
 * screen's button reads Play. Withdrawing pause to make the system draw stop was tried on paper and
 * rejected, because the same command is what a headset's pause key arrives as.
 */
@OptIn(UnstableApi::class)
class LiveNotificationProvider(private val context: Context) : DefaultMediaNotificationProvider(context) {
    override fun getMediaButtons(
        session: MediaSession,
        playerCommands: Player.Commands,
        mediaButtonPreferences: ImmutableList<CommandButton>,
        showPauseButton: Boolean,
    ): ImmutableList<CommandButton> {
        val buttons = super.getMediaButtons(session, playerCommands, mediaButtonPreferences, showPauseButton)
        if (!showPauseButton) return buttons

        return ImmutableList.copyOf(
            buttons.map { button ->
                if (button.playerCommand != Player.COMMAND_PLAY_PAUSE) {
                    button
                } else {
                    CommandButton.Builder(CommandButton.ICON_STOP)
                        .setPlayerCommand(Player.COMMAND_PLAY_PAUSE)
                        .setDisplayName(context.getString(R.string.stop))
                        // Carries the compact-view index, which is what keeps the button visible
                        // in the collapsed notification rather than only the expanded one.
                        .setExtras(button.extras)
                        .setEnabled(button.isEnabled)
                        .build()
                }
            },
        )
    }
}
