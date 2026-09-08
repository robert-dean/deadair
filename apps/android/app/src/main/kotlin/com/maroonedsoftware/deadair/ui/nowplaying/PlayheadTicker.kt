package com.maroonedsoftware.deadair.ui.nowplaying

import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.maroonedsoftware.deadair.nowplaying.Playhead
import com.maroonedsoftware.deadair.nowplaying.Reading
import com.maroonedsoftware.deadair.nowplaying.project
import kotlinx.coroutines.delay

/**
 * The playhead, moving.
 *
 * Half a second is fast enough to look continuous and slow enough to cost nothing. The clock is
 * elapsed-since-boot, the same one the reading was stamped with, so the two are measured against
 * the same thing and a device whose wall clock is corrected mid-record does not make the bar jump.
 */
@Composable
fun rememberPlayhead(reading: Reading?): Playhead? {
    var now by remember { mutableStateOf(SystemClock.elapsedRealtime()) }

    LaunchedEffect(reading) {
        while (true) {
            now = SystemClock.elapsedRealtime()
            delay(TICK_MS)
        }
    }

    return project(reading?.nowPlaying?.track, reading?.readAtMs ?: 0, now)
}

private const val TICK_MS = 500L
