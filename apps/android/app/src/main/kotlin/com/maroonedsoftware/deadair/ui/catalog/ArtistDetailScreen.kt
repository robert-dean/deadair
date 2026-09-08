package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.sdk.models.Album
import com.maroonedsoftware.deadair.sdk.models.Artist
import com.maroonedsoftware.deadair.ui.LoadState

/** An artist: their picture, how much of theirs the station holds, the operator's mark, the biography first, and the albums. */
@Composable
fun ArtistDetailScreen(
    state: LoadState<Artist>,
    albums: LoadState<Page<Album>>,
    enrichment: LoadState<EnrichmentUiState>,
    artUrlFor: (String?) -> String?,
    rating: RatingHandler?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onAlbum: (String) -> Unit,
    /** This page can rate, so it says what the station answered. */
    snackbarHost: SnackbarHostState,
) {
    DetailScaffold(
        title = stringResource(R.string.artist),
        state = state,
        onBack = onBack,
        onRetry = onRetry,
        snackbarHost = snackbarHost,
        failureText = { status -> detailFailure(status, R.string.artist_not_found) },
    ) { artist ->
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Art(artUrlFor(artist.imageUrl), size = 96.dp)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(artist.name, style = MaterialTheme.typography.titleLarge)
                val albums = artist.albumCount.toInt()
                val tracks = artist.trackCount.toInt()
                Text(
                    listOf(pluralStringResource(R.plurals.albums_count, albums, albums), pluralStringResource(R.plurals.tracks_count, tracks, tracks)).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        rating?.let {
            RatingControl(rating = artist.rating, label = artist.name, busy = it.busy, onRate = it.onRate, modifier = Modifier.padding(top = 16.dp))
            Text(
                stringResource(R.string.rating_caption),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        // The biography before the albums, because it is what somebody opens an artist to read.
        SectionHeading(stringResource(R.string.about_this_artist))
        EnrichmentPanel(enrichment, emptyMessage = stringResource(R.string.enrichment_empty_artist))

        SectionHeading(stringResource(R.string.albums))
        when (albums) {
            LoadState.Loading -> Text(stringResource(R.string.loading), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            is LoadState.Failed -> Text(stringResource(R.string.error_could_not_reach), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            is LoadState.Loaded ->
                if (albums.value.items.isEmpty()) {
                    Text(stringResource(R.string.artist_no_albums), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        albums.value.items.forEachIndexed { index, album ->
                            val id = album.id.toString()
                            val count = album.trackCount.toInt()
                            ListItem(
                                leadingContent = { Art(artUrlFor(album.imageUrl), size = 48.dp) },
                                headlineContent = { Text(album.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                supportingContent = {
                                    Text(listOfNotNull(album.year?.toString(), pluralStringResource(R.plurals.tracks_count, count, count)).joinToString(" · "))
                                },
                                modifier = Modifier.clickable { onAlbum(id) },
                            )
                            if (index < albums.value.items.lastIndex) HorizontalDivider()
                        }
                        NotShown(albums.value.notShown)
                    }
                }
        }
    }
}
