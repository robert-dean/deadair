package com.maroonedsoftware.deadair.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import kotlinx.coroutines.delay

/**
 * The wall clock, as state that moves once a minute.
 *
 * For labels like "Yesterday" and "14:03", which are written relative to now and so go stale as
 * midnight passes. Reading `System.currentTimeMillis()` during composition answered the same
 * question, but it was a side effect hiding in a layout pass: the label refreshed whenever
 * something ELSE recomposed, which happened often enough to look right and was never the reason.
 * A minute is as fine as any of these labels can tell.
 */
@Composable
fun rememberNowEpochMs(): State<Long> =
    produceState(System.currentTimeMillis()) {
        while (true) {
            delay(MINUTE_MS)
            value = System.currentTimeMillis()
        }
    }

private const val MINUTE_MS = 60_000L
