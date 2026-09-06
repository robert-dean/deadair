package com.maroonedsoftware.deadair.ui.history

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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.history.HistoryState
import com.maroonedsoftware.deadair.sdk.models.HistoryEntry
import com.maroonedsoftware.deadair.ui.EmptyPlaceholder
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.Refreshable
import com.maroonedsoftware.deadair.ui.SignedOutPlaceholder
import com.maroonedsoftware.deadair.ui.StaleBanner
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.Gutter
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
    onRetry: () -> Unit,
    onSettings: () -> Unit,
) {
    when (state) {
        HistoryState.SignedOut -> SignedOutPlaceholder(stringResource(R.string.tab_history), onSettings)
        HistoryState.Loading -> Loading()
        HistoryState.Unreachable -> ErrorPlaceholder(stringResource(R.string.error_could_not_reach), onRetry)
        is HistoryState.Loaded ->
            Refreshable(state = state, onRefresh = onRetry) {
                if (state.entries.isEmpty()) {
                    EmptyPlaceholder(stringResource(R.string.history_empty))
                } else {
                    Records(state, artUrlFor, nowEpochMs, scope, onLoadMore)
                }
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

    Column(modifier = Modifier.fillMaxSize()) {
        // Said once, above the list and at full opacity, rather than by dimming every line below
        // it. Above the list rather than as its first row, because a row inserted at the top of a
        // lazy list lands just out of view: the list keeps the row a reader was looking at where
        // it was, which is right for a feed and wrong for a notice.
        if (state.stale) StaleBanner(state.lastGoodAtMs, modifier = Modifier.padding(horizontal = Gutter, vertical = 8.dp))

        LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
            items(state.entries, key = { it.id }) { entry ->
                Record(entry, artUrlFor(entry.artworkUrl), nowEpochMs, zone, stale = state.stale)
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
                            Text(stringResource(R.string.earlier))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Record(entry: HistoryEntry, artworkUrl: String?, nowEpochMs: Long, zone: ZoneId, stale: Boolean) {
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
                    // The picture fades a little when the reading is stale; the words do not.
                    AsyncImage(model = artworkUrl, contentDescription = null, modifier = Modifier.fillMaxSize().alpha(if (stale) STALE_ALPHA else 1f))
                }
            }
        },
        headlineContent = { Text(entry.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = { Text(entry.artists, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        trailingContent = {
            Text(
                Message.Aired(airedLabel(entry.airedAt.toEpochMilliseconds(), nowEpochMs, zone)).resolve(),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    )
}

/** How far a picture fades when the reading behind it is no longer current. Pictures only; never text. */
private const val STALE_ALPHA = 0.4f
