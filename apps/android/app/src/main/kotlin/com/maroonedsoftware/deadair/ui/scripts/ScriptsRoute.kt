package com.maroonedsoftware.deadair.ui.scripts

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.scripts.BreakShareOutcome
import com.maroonedsoftware.deadair.scripts.BreakSharer
import com.maroonedsoftware.deadair.scripts.ScriptsRepository
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import kotlinx.coroutines.launch

/**
 * What it said, wired.
 *
 * The repository is made here rather than in the graph, because it is narrowed to one break when
 * a running-order row opened it and the whole history otherwise, and each screen wants its own.
 * It lives as long as the screen does.
 */
@Composable
fun ScriptsRoute(graph: AppGraph, segmentId: String?, onBack: () -> Unit, onSignIn: () -> Unit) {
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

    val snackbarHost = remember { SnackbarHostState() }
    ShowOperatorNotices(graph.operator.notices, snackbarHost)

    // Sharing asks the station for its small copy of the break, then opens the share sheet with it.
    // One at a time, as rating is: a second tap while a copy is being made is ignored rather than
    // queued, so a slow station never opens two share sheets.
    val context = LocalContext.current
    val sharer = remember(context) { BreakSharer(context.applicationContext, graph.sessions) }
    val chooserTitle = Message.SendThisBreak.resolve()
    var sharingId by remember { mutableStateOf<String?>(null) }
    var shareFailure by remember { mutableStateOf<Message?>(null) }
    val sharing =
        if (session !is SessionState.SignedIn) {
            null
        } else {
            BreakShareHandler(sharingId) { attempt ->
                val segmentId = attempt.segmentId
                if (sharingId != null || segmentId == null) return@BreakShareHandler
                sharingId = attempt.id
                scope.launch {
                    try {
                        when (val outcome = sharer.prepare(segmentId, chooserTitle)) {
                            is BreakShareOutcome.Ready -> context.startActivity(outcome.chooser)
                            is BreakShareOutcome.Failed -> shareFailure = outcome.why
                        }
                    } finally {
                        sharingId = null
                    }
                }
            }
        }
    shareFailure?.let { failure ->
        val words = failure.resolve()
        LaunchedEffect(failure) {
            snackbarHost.showSnackbar(words)
            if (shareFailure == failure) shareFailure = null
        }
    }

    ScriptsScreen(
        oneBreak = segmentId != null,
        state = state,
        scope = scope,
        onBack = onBack,
        onLoadMore = repository::loadMore,
        onRetry = repository::retry,
        onSignIn = onSignIn,
        rating = rating,
        sharing = sharing,
        snackbarHost = snackbarHost,
    )
}
