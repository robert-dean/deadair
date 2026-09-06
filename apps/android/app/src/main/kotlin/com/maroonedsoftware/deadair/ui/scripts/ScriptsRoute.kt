package com.maroonedsoftware.deadair.ui.scripts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.scripts.ScriptsRepository
import kotlinx.coroutines.launch

/**
 * What it said, wired.
 *
 * The repository is made here rather than in the graph, because it is narrowed to one break when
 * a running-order row opened it and the whole history otherwise, and each screen wants its own.
 * It lives as long as the screen does.
 */
@Composable
fun ScriptsRoute(graph: AppGraph, segmentId: String?, onBack: () -> Unit, onSettings: () -> Unit) {
    val scope = rememberCoroutineScope()
    val repository =
        remember(segmentId) {
            ScriptsRepository(
                session = graph.sessions.state,
                segmentId = segmentId,
                fetch = { query -> graph.sessions.withSession { it.render.readScriptHistory(query) } },
                scope = scope,
            )
        }
    val state by repository.state.collectAsStateWithLifecycle()
    val session by graph.sessions.state.collectAsStateWithLifecycle()
    val isOperator = (session as? SessionState.SignedIn)?.isOperator == true

    var busyId by remember { mutableStateOf<String?>(null) }
    val rating =
        if (!isOperator) {
            null
        } else {
            ScriptRatingHandler(busyId) { id, mark ->
                if (busyId != null) return@ScriptRatingHandler
                busyId = id
                scope.launch {
                    try {
                        graph.scripts.rate(id, mark)?.let(repository::replace)
                    } finally {
                        busyId = null
                    }
                }
            }
        }

    ScriptsScreen(
        oneBreak = segmentId != null,
        state = state,
        scope = scope,
        onBack = onBack,
        onLoadMore = repository::loadMore,
        onRetry = repository::retry,
        onSettings = onSettings,
        rating = rating,
    )
}
