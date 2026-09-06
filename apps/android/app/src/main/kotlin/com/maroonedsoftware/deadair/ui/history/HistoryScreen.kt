package com.maroonedsoftware.deadair.ui.history

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.history.HistoryState
import com.maroonedsoftware.deadair.sdk.models.HistoryEntry
import com.maroonedsoftware.deadair.ui.EmptyPlaceholder
import com.maroonedsoftware.deadair.ui.SignedOutPlaceholder
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * What the station has played, newest first.
 *
 * A list and nothing else: no play buttons, no request button, no way back. A listener cannot make
 * the station play something again, and offering a control that does nothing would be the app
 * pretending otherwise. What this is for is the question a radio listener has always had — what was
 * that? — and the answer is a name, a cover and a time.
 */
@Composable
fun HistoryScreen(
    state: HistoryState,
    artUrlFor: (String?) -> String?,
    nowEpochMs: Long,
    scope: CoroutineScope,
    onLoadMore: suspend () -> Unit,
    onSettings: () -> Unit,
) {
    when (state) {
        HistoryState.SignedOut -> SignedOutPlaceholder("Recently played", onSettings)
        HistoryState.Loading -> Loading()
        HistoryState.Unreachable -> EmptyPlaceholder("Could not reach the station.")
        is HistoryState.Loaded ->
            if (state.entries.isEmpty()) {
                EmptyPlaceholder("Nothing has aired yet.")
            } else {
                Records(state, artUrlFor, nowEpochMs, scope, onLoadMore)
            }
    }
}

@Composable
private fun Loading() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun Records(
    state: HistoryState.Loaded,
    artUrlFor: (String?) -> String?,
    nowEpochMs: Long,
    scope: CoroutineScope,
    onLoadMore: suspend () -> Unit,
) {
    // The device's own zone, read once per composition rather than per row: `airedAt` is a real
    // instant, so this is the zone it should be read back in.
    val zone = remember { ZoneId.systemDefault() }

    LazyColumn(modifier = Modifier.fillMaxSize().alpha(if (state.stale) STALE_ALPHA else 1f)) {
        items(state.entries, key = { it.id }) { entry ->
            Record(entry, artUrlFor(entry.artworkUrl), nowEpochMs, zone)
            HorizontalDivider()
        }

        if (state.canLoadMore) {
            item {
                if (state.loadingMore) {
                    Box(modifier = Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    }
                } else {
                    // Asked for rather than fetched on scroll. A listener walking back through a
                    // day of radio is spending the station's time as well as their own, and a list
                    // that loaded forever on its own would do that without being told to.
                    TextButton(onClick = { scope.launch { onLoadMore() } }, modifier = Modifier.fillMaxWidth().padding(8.dp)) {
                        Text("Earlier")
                    }
                }
            }
        }

        if (state.stale) {
            item {
                Text(
                    "Could not reach the station just now. This is the last it said.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
    }
}

@Composable
private fun Record(entry: HistoryEntry, artworkUrl: String?, nowEpochMs: Long, zone: ZoneId) {
    ListItem(
        leadingContent = {
            Box(
                modifier = Modifier.size(48.dp).clip(RoundedCornerShape(4.dp)),
                contentAlignment = Alignment.Center,
            ) {
                if (artworkUrl == null) {
                    // A record the catalog holds nothing for, which is the ordinary state of a
                    // station running no catalog rather than a failure worth marking as one.
                    Icon(
                        painterResource(R.drawable.ic_radio),
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    AsyncImage(model = artworkUrl, contentDescription = null, modifier = Modifier.fillMaxSize())
                }
            }
        },
        headlineContent = { Text(entry.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(entry.artists, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        trailingContent = {
            Text(
                airedLabel(entry.airedAt.toEpochMilliseconds(), nowEpochMs, zone),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    )
}

/** The same dimming everything else here uses for a reading that is no longer current. */
private const val STALE_ALPHA = 0.4f
