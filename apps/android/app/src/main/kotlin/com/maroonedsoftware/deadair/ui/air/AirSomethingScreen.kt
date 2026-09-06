package com.maroonedsoftware.deadair.ui.air

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.catalog.DetailScaffold
import com.maroonedsoftware.deadair.ui.catalog.SectionHeading
import com.maroonedsoftware.deadair.ui.catalog.detailFailure

/** What could be put on air: the playlists every plugin offers, by plugin, and the charts. */
@Composable
fun AirSomethingScreen(
    state: LoadState<AirUiState>,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onPlaylist: (pluginId: String, playlistId: String) -> Unit,
    onChart: (chartId: String) -> Unit,
) {
    DetailScaffold(
        title = stringResource(R.string.air_something),
        state = state,
        onBack = onBack,
        onRetry = onRetry,
        failureText = { status -> detailFailure(status, R.string.error_could_not_reach) },
    ) { ui ->
        Text(stringResource(R.string.air_something_intro), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

        if (ui.isEmpty && ui.sourceErrors.isEmpty()) {
            Text(stringResource(R.string.air_nothing_offered), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 24.dp))
        }

        ui.groups.forEach { group ->
            SectionHeading(group.pluginName)
            Column(modifier = Modifier.fillMaxWidth()) {
                group.playlists.forEachIndexed { index, playlist ->
                    ListItem(
                        headlineContent = { Text(playlist.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = {
                            val count = playlist.trackCount?.toInt()
                            val line =
                                listOfNotNull(
                                    count?.let { pluralStringResource(R.plurals.tracks_count, it, it) },
                                    playlist.description?.takeIf { it.isNotBlank() },
                                ).joinToString(" · ")
                            if (line.isNotEmpty()) Text(line, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        },
                        modifier = Modifier.clickable { onPlaylist(playlist.pluginId, playlist.id) },
                    )
                    if (index < group.playlists.lastIndex) HorizontalDivider()
                }
            }
        }

        // Beside the ones that answered rather than in place of them: one provider being down is
        // the ordinary state of a station with several.
        ui.sourceErrors.forEach { error ->
            Text(
                stringResource(R.string.source_error, error.pluginName, error.message),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 12.dp),
            )
        }

        if (ui.charts.isNotEmpty()) {
            SectionHeading(stringResource(R.string.charts))
            Column(modifier = Modifier.fillMaxWidth()) {
                ui.charts.forEachIndexed { index, chart ->
                    ListItem(
                        headlineContent = { Text(chart.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = {
                            val line = (chartQualifiers(chart) + listOfNotNull(chart.description?.takeIf { it.isNotBlank() })).joinToString(" · ")
                            if (line.isNotEmpty()) Text(line, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        },
                        modifier = Modifier.clickable { onChart(chart.id) },
                    )
                    if (index < ui.charts.lastIndex) HorizontalDivider()
                }
            }
        }
    }
}
