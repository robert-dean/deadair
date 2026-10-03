package com.maroonedsoftware.deadair.ui.scripts

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.scripts.BreakCopy
import com.maroonedsoftware.deadair.scripts.BreakShareOutcome
import com.maroonedsoftware.deadair.scripts.BreakSharer
import com.maroonedsoftware.deadair.scripts.ScriptsRepository
import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import java.io.File
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

    // Sharing and saving both ask the station for its small copy of the break first; then sharing
    // opens the share sheet with it and saving opens the system's save dialog. One at a time, as
    // rating is: a second tap while a copy is being made is ignored rather than queued, so a slow
    // station never opens two sheets.
    val context = LocalContext.current
    val sharer = remember(context) { BreakSharer(context.applicationContext, graph.sessions) }
    val chooserTitle = Message.SendThisBreak.resolve()
    var sharingId by remember { mutableStateOf<String?>(null) }
    // What the station answered a share or save with, for the snackbar: why it failed, or that it was saved.
    var shareNotice by remember { mutableStateOf<Message?>(null) }
    // The copy waiting for the save dialog to answer, as its path and type. Saveable, because turning
    // the phone while the dialog is up recreates this screen and the answer arrives at the new one.
    // If the cache was cleared meanwhile, the write fails and says so rather than saving nothing.
    var savingPath by rememberSaveable { mutableStateOf<String?>(null) }
    var savingMime by rememberSaveable { mutableStateOf<String?>(null) }
    val save =
        rememberLauncherForActivityResult(SaveBreakDocument()) { destination ->
            val path = savingPath ?: return@rememberLauncherForActivityResult
            val copy = BreakCopy(File(path), savingMime ?: return@rememberLauncherForActivityResult)
            savingPath = null
            savingMime = null
            // Dismissing the dialog is an answer, not a failure.
            if (destination == null) return@rememberLauncherForActivityResult
            scope.launch { shareNotice = if (sharer.saveTo(copy, destination)) Message.BreakSaved else Message.SaveFailed }
        }
    val sharing =
        if (session !is SessionState.SignedIn) {
            null
        } else {
            fun handle(attempt: ScriptAttempt, then: (BreakCopy) -> Unit) {
                val segmentId = attempt.segmentId
                if (sharingId != null || segmentId == null) return
                sharingId = attempt.id
                scope.launch {
                    try {
                        when (val outcome = sharer.fetch(segmentId)) {
                            is BreakShareOutcome.Ready -> then(outcome.copy)
                            is BreakShareOutcome.Failed -> shareNotice = outcome.why
                        }
                    } finally {
                        sharingId = null
                    }
                }
            }
            BreakShareHandler(
                busyId = sharingId,
                onShare = { attempt -> handle(attempt) { copy -> context.startActivity(sharer.chooser(copy, chooserTitle)) } },
                onSave = { attempt ->
                    handle(attempt) { copy ->
                        savingPath = copy.file.path
                        savingMime = copy.mime
                        save.launch(copy)
                    }
                },
            )
        }
    shareNotice?.let { notice ->
        val words = notice.resolve()
        LaunchedEffect(notice) {
            snackbarHost.showSnackbar(words)
            if (shareNotice == notice) shareNotice = null
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
