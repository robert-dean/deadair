package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.sdk.models.Rating
import com.maroonedsoftware.deadair.ui.LoadState
import kotlinx.coroutines.launch

/**
 * The operator's rating control for a detail page, or nothing for anyone else.
 *
 * One write at a time, and the page is re-read after a write that landed so the control shows the
 * mark the station now holds rather than the one that was pressed.
 */
@Composable
fun rememberRating(graph: AppGraph, detail: Detail<*>, write: suspend (Rating) -> Boolean): RatingHandler? {
    val session by graph.sessions.state.collectAsStateWithLifecycle()
    val isOperator = (session as? SessionState.SignedIn)?.isOperator == true
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    if (!isOperator || detail.state !is LoadState.Loaded) return null

    return RatingHandler(busy) { mark ->
        if (busy) return@RatingHandler
        busy = true
        scope.launch {
            try {
                if (write(mark)) detail.reload()
            } finally {
                busy = false
            }
        }
    }
}
