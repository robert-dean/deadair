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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import com.maroonedsoftware.deadair.sdk.models.Rating
import com.maroonedsoftware.deadair.sdk.models.TrackDetail
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.history.airedLabel
import com.maroonedsoftware.deadair.ui.rememberNowEpochMs
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import java.time.ZoneId

/** The operator's mark on the record. `null` for anyone the station does not call its operator. */
data class RatingHandler(val busy: Boolean, val onRate: (Rating) -> Unit)

/**
 * One record: what it is, when it aired, and what the providers said about it.
 *
 * No copies and no measurement. Those two cards answer "why will this record not play", which is a
 * laptop question with a `docker` answer; the phone carries what a listener or an operator wants to
 * know about the record they just heard.
 */
@Composable
fun TrackDetailScreen(
    state: LoadState<TrackDetail>,
    enrichment: LoadState<EnrichmentUiState>,
    artUrlFor: (String?) -> String?,
    rating: RatingHandler?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onArtist: ((String) -> Unit)? = null,
    onAlbum: ((String) -> Unit)? = null,
) {
    DetailScaffold(
        title = stringResource(R.string.record),
        state = state,
        onBack = onBack,
        onRetry = onRetry,
        failureText = { status -> detailFailure(status, R.string.record_not_found) },
    ) { detail ->
        Header(detail, artUrlFor(detail.albumImageUrl), onArtist, onAlbum)

        rating?.let {
            RatingControl(rating = detail.rating, label = detail.title, busy = it.busy, onRate = it.onRate, modifier = Modifier.padding(top = 16.dp))
            Text(
                stringResource(R.string.rating_caption),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
        }

        Airings(detail)

        SectionHeading(stringResource(R.string.about_this_record))
        EnrichmentPanel(enrichment, emptyMessage = stringResource(R.string.enrichment_empty_record))
    }
}

@Composable
private fun Header(detail: TrackDetail, artworkUrl: String?, onArtist: ((String) -> Unit)?, onAlbum: ((String) -> Unit)?) {
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
        Box(modifier = Modifier.size(112.dp).clip(RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
            if (artworkUrl == null) {
                Icon(painterResource(R.drawable.ic_radio), contentDescription = null, modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                AsyncImage(model = artworkUrl, contentDescription = null, modifier = Modifier.fillMaxSize())
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(detail.title, style = MaterialTheme.typography.titleLarge)
            // The credit as a link to the canonical artist, when a page can be reached from here.
            val artistId = detail.artistId.toString()
            Text(
                detail.artists,
                style = MaterialTheme.typography.bodyLarge,
                color = if (onArtist != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = if (onArtist != null) Modifier.clickable(role = Role.Button) { onArtist(artistId) } else Modifier,
            )
            val albumId = detail.albumId?.toString()
            detail.albumName?.let { album ->
                Text(
                    album,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (onAlbum != null && albumId != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = if (onAlbum != null && albumId != null) Modifier.clickable(role = Role.Button) { onAlbum(albumId) } else Modifier,
                )
            }
            // The year off the file itself, which the station's own period filter reads; the
            // providers' release date, when it differs, is in the panel below.
            val meta = listOfNotNull(detail.year?.toString(), detail.durationMs?.let(::clockOf), detail.genre?.takeIf { it.isNotBlank() })
            if (meta.isNotEmpty()) {
                Text(meta.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** When the station played it, newest first, and how many times in all. */
@Composable
private fun Airings(detail: TrackDetail) {
    SectionHeading(stringResource(R.string.airings))
    val count = detail.playCount.toInt()
    Text(
        if (count == 0) stringResource(R.string.never_aired) else pluralStringResource(R.plurals.aired_times, count, count),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (detail.plays.isEmpty()) return

    val zone = remember { ZoneId.systemDefault() }
    val nowEpochMs by rememberNowEpochMs()
    Column(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        detail.plays.sortedByDescending { it.airedAt }.forEachIndexed { index, play ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(Message.Aired(airedLabel(play.airedAt.toEpochMilliseconds(), nowEpochMs, zone)).resolve(), style = MaterialTheme.typography.bodyMedium)
                Text(play.source, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (index < detail.plays.lastIndex) HorizontalDivider()
        }
    }
}
