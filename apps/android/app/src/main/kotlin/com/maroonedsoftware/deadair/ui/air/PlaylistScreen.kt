package com.maroonedsoftware.deadair.ui.air

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.clockOf
import com.maroonedsoftware.deadair.sdk.models.CatalogPlaylistTracks
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.catalog.DetailScaffold
import com.maroonedsoftware.deadair.ui.catalog.detailFailure

/** One plugin's playlist: its tracks, and the button that puts them on air. */
@Composable
fun PlaylistScreen(
    title: String,
    state: LoadState<CatalogPlaylistTracks>,
    busy: Boolean,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    /** This page puts something on air, so it says what the station answered. */
    snackbarHost: SnackbarHostState,
    onAir: () -> Unit,
) {
    var confirming by rememberSaveable { mutableStateOf(false) }

    DetailScaffold(
        title = title,
        state = state,
        onBack = onBack,
        onRetry = onRetry,
        snackbarHost = snackbarHost,
        failureText = { status -> detailFailure(status, R.string.playlist_unavailable) },
    ) { playlist ->
        val count = playlist.tracks.size
        Text(pluralStringResource(R.plurals.tracks_count, count, count), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

        if (canAir(playlist.tracks)) {
            Button(onClick = { confirming = true }, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
                Text(stringResource(R.string.air_this_playlist))
            }
        } else {
            Text(stringResource(R.string.playlist_no_tracks), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 16.dp))
        }

        Column(modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
            playlist.tracks.forEachIndexed { index, track ->
                ListItem(
                    headlineContent = { Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    supportingContent = {
                        val line = listOfNotNull(track.artists.joinToString(", ").ifBlank { null }, track.durationMs?.let(::clockOf)).joinToString(" · ")
                        if (line.isNotEmpty()) Text(line, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    },
                )
                if (index < playlist.tracks.lastIndex) HorizontalDivider()
            }
        }
    }

    if (confirming) {
        ConfirmAir(
            what = title,
            onConfirm = {
                confirming = false
                onAir()
            },
            onDismiss = { confirming = false },
        )
    }
}
