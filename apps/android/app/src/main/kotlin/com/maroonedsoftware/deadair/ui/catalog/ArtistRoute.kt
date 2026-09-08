package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.sdk.models.CatalogQueryInput
import com.maroonedsoftware.deadair.sdk.models.CatalogSort
import com.maroonedsoftware.deadair.sdk.models.PaginationSort
import com.maroonedsoftware.deadair.settings.ListenerSettings
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** The artist page, wired. */
@OptIn(ExperimentalUuidApi::class)
@Composable
fun ArtistRoute(graph: AppGraph, settings: ListenerSettings, artistId: String, onBack: () -> Unit, onAlbum: (String) -> Unit) {
    val id = remember(artistId) { Uuid.parse(artistId) }
    val detail = rememberDetail(artistId) { graph.sessions.withSession { it.catalog.getArtist(id) } }
    val albums =
        rememberDetail("$artistId/albums") {
            val page = graph.sessions.withSession { it.catalog.listArtistAlbums(id, CatalogQueryInput(page = 0, pageSize = PAGE_MAX, sort = PaginationSort.DESC, sortBy = CatalogSort.YEAR)) }
            Page(page.data, page.meta.total)
        }
    val enrichment =
        rememberDetail("$artistId/enrichment") {
            val answer = graph.sessions.withSession { it.catalog.getArtistEnrichment(id) }
            EnrichmentUiState(EnrichmentFacts.of(answer.merged), answer.sources.map(Provenance::of), answer.claims)
        }
    val rating = rememberRating(graph, detail) { mark -> graph.catalog.rateArtist(artistId, mark) }

    val snackbarHost = remember { SnackbarHostState() }
    ShowOperatorNotices(graph.operator.notices, snackbarHost)

    ArtistDetailScreen(
        state = detail.state,
        albums = albums.state,
        enrichment = enrichment.state,
        artUrlFor = { url -> settings.station?.artUrl(url) },
        rating = rating,
        onBack = onBack,
        onRetry = {
            detail.reload()
            albums.reload()
            enrichment.reload()
        },
        onAlbum = onAlbum,
        snackbarHost = snackbarHost,
    )
}
