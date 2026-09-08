package com.maroonedsoftware.deadair.playback

import androidx.media3.common.Player

/**
 * Which transport commands a live stream takes away.
 *
 * A notification, a lock screen and a Bluetooth head unit all build their controls from the
 * commands the session advertises, so this list is what decides which buttons exist. Everything
 * that implies a position or a queue goes, because a live stream has neither and a button that
 * could never do anything is worse than no button.
 *
 * The next control is the one exception, and it is not a position: it carries the OPERATOR's Skip,
 * which ends the record on air for everybody listening. So it is offered only to an account the
 * station calls its operator, and withdrawn again the moment that stops being true. A pure function
 * because the rule is the whole point and a JVM test can read it.
 */
internal fun withdrawnCommands(canSkip: Boolean): IntArray = if (canSkip) WITHDRAWN else WITHDRAWN_AND_NEXT

/** Nothing that implies a position or a queue. */
private val WITHDRAWN =
    intArrayOf(
        Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
        Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
        Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
        Player.COMMAND_SEEK_TO_PREVIOUS,
        // There is no next ITEM either way: the running order is the station's, not the player's,
        // and this is the command a queue would be walked with.
        Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
        Player.COMMAND_SEEK_TO_MEDIA_ITEM,
        Player.COMMAND_SEEK_BACK,
        Player.COMMAND_SEEK_FORWARD,
        Player.COMMAND_SET_SPEED_AND_PITCH,
    )

/** Both computed once: `isCommandAvailable` is asked often enough that building an array per call would be waste. */
private val WITHDRAWN_AND_NEXT = WITHDRAWN + Player.COMMAND_SEEK_TO_NEXT
