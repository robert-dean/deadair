package com.maroonedsoftware.deadair.ui.air

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.catalog.rememberDetail
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** The list of everything that could be aired, wired. */
@Composable
fun AirSomethingRoute(graph: AppGraph, onBack: () -> Unit, onPlaylist: (String, String) -> Unit, onChart: (String) -> Unit) {
    val detail =
        rememberDetail("air") {
            // Both at once: a station with a slow provider should not hold the charts behind it.
            coroutineScope {
                val playlists = async { runCatching { graph.sessions.withSession { it.playlists.listImportablePlaylists() } }.getOrNull() }
                val charts = async { graph.sessions.withSession { it.charts.listCharts() }.charts }
                AirUiState(playlists.await(), charts.await())
            }
        }
    AirSomethingScreen(state = detail.state, onBack = onBack, onRetry = detail::reload, onPlaylist = onPlaylist, onChart = onChart)
}

/** One playlist, wired. Airing it pops back to Home, where the transport shows what happened. */
@Composable
fun PlaylistRoute(graph: AppGraph, pluginId: String, playlistId: String, onBack: () -> Unit, onAired: () -> Unit) {
    val detail = rememberDetail("$pluginId/$playlistId") { graph.sessions.withSession { it.playlists.getPlaylistTracks(pluginId, playlistId) } }
    val name = rememberDetail("$pluginId/$playlistId/name") {
        graph.sessions.withSession { it.playlists.listImportablePlaylists() }.playlists.firstOrNull { it.pluginId == pluginId && it.id == playlistId }?.name
    }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }

    PlaylistScreen(
        title = (name.state as? LoadState.Loaded)?.value ?: playlistId,
        state = detail.state,
        busy = busy,
        onBack = onBack,
        onRetry = detail::reload,
        onAir = {
            if (busy) return@PlaylistScreen
            busy = true
            scope.launch {
                try {
                    if (graph.air.airPlaylist(pluginId, playlistId)) onAired()
                } finally {
                    busy = false
                }
            }
        },
    )
}

/** One chart, wired. */
@Composable
fun ChartRoute(graph: AppGraph, chartId: String, onBack: () -> Unit, onAired: () -> Unit) {
    val detail = rememberDetail(chartId) { graph.sessions.withSession { it.charts.readChart(chartId) } }
    val name = rememberDetail("$chartId/name") { graph.sessions.withSession { it.charts.listCharts() }.charts.firstOrNull { it.id == chartId }?.name }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }

    ChartScreen(
        title = (name.state as? LoadState.Loaded)?.value ?: chartId,
        state = detail.state,
        busy = busy,
        onBack = onBack,
        onRetry = detail::reload,
        onAir = { order ->
            if (busy) return@ChartScreen
            busy = true
            scope.launch {
                try {
                    if (graph.air.airChart(chartId, order)) onAired()
                } finally {
                    busy = false
                }
            }
        },
    )
}
