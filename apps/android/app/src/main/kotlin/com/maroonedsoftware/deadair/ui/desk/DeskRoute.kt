package com.maroonedsoftware.deadair.ui.desk

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.ui.nowplaying.TransportHandlers
import kotlinx.coroutines.launch

/**
 * The desk, wired.
 *
 * The two-second transport poll is collected here, so it runs while the desk is up and stops a
 * few seconds after it is left. The desk has its own snackbar, because a refusal raised while it is
 * on top would otherwise be posted to a Home that is not composed.
 */
@Composable
fun DeskRoute(graph: AppGraph, settings: ListenerSettings, onBack: () -> Unit, onSignIn: () -> Unit) {
    val playout by graph.playout.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()

    // One action at a time, so a second press waits for the first rather than queueing behind it:
    // two skips in flight would take two records off air.
    var busy by remember { mutableStateOf(false) }
    fun act(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                action()
            } finally {
                busy = false
            }
        }
    }
    val handlers =
        remember(graph) {
            TransportHandlers(
                onSkip = { act { graph.transport.skip() } },
                onStop = { act { graph.transport.stop() } },
                onStart = { act { graph.transport.start() } },
                onHold = { minutes -> act { graph.transport.hold(minutes) } },
                onRelease = { act { graph.transport.release() } },
                onAirMode = { mode -> act { graph.transport.setAirMode(mode) } },
            )
        }

    val snackbarHost = remember { SnackbarHostState() }
    ShowOperatorNotices(graph.operator.notices, snackbarHost)

    DeskScreen(
        playout = playout,
        format = settings.format,
        artUrlFor = { url -> settings.station?.artUrl(url) },
        busy = busy,
        handlers = handlers,
        onBack = onBack,
        onRetry = graph.playout::retry,
        onSignIn = onSignIn,
        snackbarHost = snackbarHost,
    )
}
