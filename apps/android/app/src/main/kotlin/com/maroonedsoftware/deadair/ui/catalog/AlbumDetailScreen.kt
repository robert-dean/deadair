package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.clockOf
import com.maroonedsoftware.deadair.sdk.models.Album
import com.maroonedsoftware.deadair.sdk.models.TrackRow
import com.maroonedsoftware.deadair.ui.LoadState

/** An album: its art, its artist, its year and how many tracks, the operator's mark, the providers' word, and the tracks. */
@Composable
fun AlbumDetailScreen(
    state: LoadState<Album>,
    tracks: LoadState<Page<TrackRow>>,
    enrichment: LoadState<EnrichmentUiState>,
    artUrlFor: (String?) -> String?,
    rating: RatingHandler?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onArtist: (String) -> Unit,
    onTrack: (String) -> Unit,
    /** This page can rate, so it says what the station answered. */
    snackbarHost: SnackbarHostState,
) {
    DetailScaffold(
        title = stringResource(R.string.album),
        state = state,
        onBack = onBack,
        onRetry = onRetry,
        snackbarHost = snackbarHost,
        failureText = { status -> detailFailure(status, R.string.album_not_found) },
    ) { album ->
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
            Art(artUrlFor(album.imageUrl), size = 112.dp)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(album.name, style = MaterialTheme.typography.titleLarge)
                val artistId = album.artistId.toString()
                Text(
                    album.artistName,
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable(role = Role.Button) { onArtist(artistId) },
                )
                val count = album.trackCount.toInt()
                val meta = listOfNotNull(album.year?.toString(), pluralStringResource(R.plurals.tracks_count, count, count))
                Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        rating?.let {
            RatingControl(rating = album.rating, label = album.name, busy = it.busy, onRate = it.onRate, modifier = Modifier.padding(top = 16.dp))
            Text(
                stringResource(R.string.rating_caption),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        SectionHeading(stringResource(R.string.tracks))
        when (tracks) {
            LoadState.Loading -> Text(stringResource(R.string.loading), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            is LoadState.Failed -> Text(stringResource(R.string.error_could_not_reach), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            is LoadState.Loaded ->
                if (tracks.value.items.isEmpty()) {
                    Text(stringResource(R.string.album_no_tracks), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    Column(modifier = Modifier.fillMaxWidth()) {
                        tracks.value.items.forEachIndexed { index, track ->
                            val id = track.id.toString()
                            ListItem(
                                headlineContent = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                supportingContent = {
                                    val line = listOfNotNull(track.artists.ifBlank { null }, track.durationMs?.let(::clockOf)).joinToString(" · ")
                                    if (line.isNotEmpty()) Text(line, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                },
                                modifier = Modifier.clickable { onTrack(id) },
                            )
                            if (index < tracks.value.items.lastIndex) HorizontalDivider()
                        }
                        NotShown(tracks.value.notShown)
                    }
                }
        }

        SectionHeading(stringResource(R.string.about_this_album))
        EnrichmentPanel(enrichment, emptyMessage = stringResource(R.string.enrichment_empty_album))
    }
}

/** The rest of a list the station holds more of than one page carries. */
@Composable
internal fun NotShown(count: Long) {
    if (count <= 0) return
    Text(
        pluralStringResource(R.plurals.more_not_shown, count.toInt(), count.toInt()),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 8.dp),
    )
}

/** A square of art, or the radio where there is none. Shared by the three pages. */
@Composable
internal fun Art(url: String?, size: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    Box(modifier = modifier.size(size).clip(RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
        if (url == null) {
            Icon(painterResource(R.drawable.ic_radio), contentDescription = null, modifier = Modifier.size(size / 3), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxSize())
        }
    }
}
