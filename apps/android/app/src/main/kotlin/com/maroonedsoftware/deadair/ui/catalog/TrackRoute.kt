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
import com.maroonedsoftware.deadair.settings.ListenerSettings
import com.maroonedsoftware.deadair.ui.LoadState
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid
import kotlinx.coroutines.launch

/** The record page, wired: two reads through the session, and the operator's mark when there is one. */
@OptIn(ExperimentalUuidApi::class)
@Composable
fun TrackRoute(
    graph: AppGraph,
    settings: ListenerSettings,
    trackId: String,
    onBack: () -> Unit,
    /** Where the credit and the album lead. `null` draws them as words rather than links. */
    onArtist: ((String) -> Unit)? = null,
    onAlbum: ((String) -> Unit)? = null,
) {
    val id = remember(trackId) { Uuid.parse(trackId) }
    val detail = rememberDetail(trackId) { graph.sessions.withSession { it.catalog.getTrack(id) } }
    val enrichment =
        rememberDetail("$trackId/enrichment") {
            val answer = graph.sessions.withSession { it.catalog.getTrackEnrichment(id) }
            EnrichmentUiState(EnrichmentFacts.of(answer.merged), answer.sources.map(Provenance::of), answer.claims)
        }

    val session by graph.sessions.state.collectAsStateWithLifecycle()
    val isOperator = (session as? SessionState.SignedIn)?.isOperator == true
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val rating =
        if (!isOperator || detail.state !is LoadState.Loaded) {
            null
        } else {
            RatingHandler(busy) { mark ->
                if (busy) return@RatingHandler
                busy = true
                scope.launch {
                    try {
                        if (graph.catalog.rateTrack(trackId, mark)) detail.reload()
                    } finally {
                        busy = false
                    }
                }
            }
        }

    TrackDetailScreen(
        state = detail.state,
        enrichment = enrichment.state,
        artUrlFor = { url -> settings.station?.artUrl(url) },
        rating = rating,
        onBack = onBack,
        onRetry = {
            detail.reload()
            enrichment.reload()
        },
        onArtist = onArtist,
        onAlbum = onAlbum,
    )
}
