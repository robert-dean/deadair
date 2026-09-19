package com.maroonedsoftware.deadair.ui.history

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.rememberNowEpochMs

/**
 * History, wired.
 *
 * The poll is collected here and nowhere else, so it runs while the page is up and stops when it is
 * left, as it did while the page was a tab.
 */
@Composable
fun HistoryRoute(graph: AppGraph, settings: ListenerSettings, onBack: () -> Unit, onSignIn: () -> Unit, onTrack: (String) -> Unit) {
    val history by graph.history.state.collectAsStateWithLifecycle()
    val nowEpochMs by rememberNowEpochMs()
    HistoryScreen(
        state = history,
        artUrlFor = { url -> settings.station?.artUrl(url) },
        nowEpochMs = nowEpochMs,
        scope = rememberCoroutineScope(),
        onBack = onBack,
        onLoadMore = graph.history::loadMore,
        onRetry = graph.history::retry,
        onSignIn = onSignIn,
        onTrack = onTrack,
    )
}
