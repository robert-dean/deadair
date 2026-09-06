package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.settings.ListenerSettings
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

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

    val rating = rememberRating(graph, detail) { mark -> graph.catalog.rateTrack(trackId, mark) }

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
