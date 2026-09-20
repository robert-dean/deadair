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
 *
 * [ticking] is whether the bar is on screen to be seen. Twice a second is nothing next to drawing
 * the screen at all, but a resting Now playing has faded the whole of its chrome to nothing and is
 * showing a still cover: the recomposition and the `animateFloatAsState` behind the bar were both
 * still running against an alpha of zero, which is the one case where the cost buys nothing at all.
 * The projection is recomputed the moment it starts again, so waking the screen shows the bar where
 * it should be rather than where it was left.
 */
@Composable
fun rememberPlayhead(reading: Reading?, ticking: Boolean = true): Playhead? {
    var now by remember { mutableStateOf(SystemClock.elapsedRealtime()) }

    LaunchedEffect(reading, ticking) {
        while (ticking) {
            now = SystemClock.elapsedRealtime()
            delay(TICK_MS)
        }
    }

    return project(reading?.nowPlaying?.track, reading?.readAtMs ?: 0, now)
}

private const val TICK_MS = 500L
