package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.sdk.models.PaginationSort
import com.maroonedsoftware.deadair.sdk.models.TrackQueryInput
import com.maroonedsoftware.deadair.sdk.models.TrackSort
import com.maroonedsoftware.deadair.settings.ListenerSettings
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** The album page, wired: three reads through the session, and the operator's mark when there is one. */
@OptIn(ExperimentalUuidApi::class)
@Composable
fun AlbumRoute(graph: AppGraph, settings: ListenerSettings, albumId: String, onBack: () -> Unit, onArtist: (String) -> Unit, onTrack: (String) -> Unit) {
    val id = remember(albumId) { Uuid.parse(albumId) }
    val detail = rememberDetail(albumId) { graph.sessions.withSession { it.catalog.getAlbum(id) } }
    val tracks =
        rememberDetail("$albumId/tracks") {
            val page = graph.sessions.withSession { it.catalog.listAlbumTracks(id, TrackQueryInput(page = 0, pageSize = PAGE_MAX, sort = PaginationSort.ASC, sortBy = TrackSort.TITLE)) }
            Page(page.data, page.meta.total)
        }
    val enrichment =
        rememberDetail("$albumId/enrichment") {
            val answer = graph.sessions.withSession { it.catalog.getAlbumEnrichment(id) }
            EnrichmentUiState(EnrichmentFacts.of(answer.merged), answer.sources.map(Provenance::of), answer.claims)
        }
    val rating = rememberRating(graph, detail) { mark -> graph.catalog.rateAlbum(albumId, mark) }

    val snackbarHost = remember { SnackbarHostState() }
    ShowOperatorNotices(graph.operator.notices, snackbarHost)

    AlbumDetailScreen(
        state = detail.state,
        tracks = tracks.state,
        enrichment = enrichment.state,
        artUrlFor = { url -> settings.station?.artUrl(url) },
        rating = rating,
        onBack = onBack,
        onRetry = {
            detail.reload()
            tracks.reload()
            enrichment.reload()
        },
        onArtist = onArtist,
        onTrack = onTrack,
        snackbarHost = snackbarHost,
    )
}
