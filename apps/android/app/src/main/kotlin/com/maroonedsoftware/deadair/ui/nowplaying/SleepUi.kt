package com.maroonedsoftware.deadair.ui.nowplaying

import com.maroonedsoftware.deadair.playback.SleepState
import com.maroonedsoftware.deadair.schedule.spanOf
import com.maroonedsoftware.deadair.ui.text.Message

/** The choices the timer offers, in minutes. */
val SLEEP_CHOICES = listOf(15L, 30L, 45L, 60L)

/**
 * What the line under the play button says about the sleep timer, or `null` when it is off.
 *
 * Rounded UP to the minute, so it never says "0 min" while there is still music playing: a listener
 * reading "Stops in 1 min" with forty seconds left is told the truth in the way that matters.
 */
fun sleepLine(state: SleepState, nowMs: Long): Message? =
    when (state) {
        SleepState.Off -> null
        is SleepState.AfterRecord -> Message.StopsAfterThisRecord
        is SleepState.Until -> {
            val left = (state.deadlineMs - nowMs).coerceAtLeast(0)
            Message.StopsIn(spanOf(((left + MINUTE_MS - 1) / MINUTE_MS).coerceAtLeast(1)))
        }
    }

private const val MINUTE_MS = 60_000L
