package com.maroonedsoftware.deadair.ui.home

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.sdk.models.NowPlayingLyrics
import kotlin.coroutines.cancellation.CancellationException

/**
 * The lyrics of the record this listener is hearing, read once per airing.
 *
 * Keyed on the heard reading's `startedAt` rather than polled, as the heart's rating is read once per
 * record ([rememberLike]): a record's words do not change while it airs, so a new airing is the only
 * thing worth asking again for. Only for a signed-in listener, because the route is a `platform.view`
 * read; signed out it asks nothing and answers `null`, which draws no button. A read that fails is the
 * same `null`, since lyrics are a nicety and an error over the cover would cost more than it says.
 */
@Composable
fun rememberLyrics(graph: AppGraph, signedIn: Boolean, heardStartedAt: Long?): NowPlayingLyrics? {
    var answer by remember { mutableStateOf<NowPlayingLyrics?>(null) }

    LaunchedEffect(signedIn, heardStartedAt) {
        // Not cleared before the read: the old answer is for a different airing, which
        // `lyricsUiState` already refuses to show, and clearing it would only flicker the button.
        if (!signedIn || heardStartedAt == null) {
            answer = null
            return@LaunchedEffect
        }
        answer =
            try {
                graph.sessions.withSession { it.nowplaying.getNowPlayingLyrics() }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                null
            }
    }

    return answer
}
