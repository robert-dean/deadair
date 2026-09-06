package com.maroonedsoftware.deadair.ui.order

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.director.OrderState
import com.maroonedsoftware.deadair.nowplaying.clockOf
import com.maroonedsoftware.deadair.sdk.models.Rating
import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.ui.EmptyPlaceholder
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.Refreshable
import com.maroonedsoftware.deadair.ui.SignedOutPlaceholder
import com.maroonedsoftware.deadair.ui.StaleBanner
import com.maroonedsoftware.deadair.ui.catalog.RatingControl
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.Gutter

/** What an operator can do to a row. `null` for anyone else, and the rows are then only read. */
data class OrderHandlers(
    /** Rate the record on a row. Offered on spent rows too: the record that just finished is the one an operator has an opinion about. */
    val onRate: (trackId: String, Rating) -> Unit,
    /** Which record's rating is being written, so its control waits rather than looking ignored. */
    val ratingTrackId: String?,
)

/**
 * The running order: what is airing, item by item, each saying where it has got to.
 *
 * The history behind the item on air starts folded behind a count, because on a phone an hour of
 * played records is an hour of scrolling in front of the four rows that have not happened yet.
 * Folded rather than dropped: which item was skipped and where is exactly what somebody opens this
 * to find. The list opens on the anchor row and follows it as the station moves.
 */
@Composable
fun RunningOrderScreen(
    state: OrderState,
    artUrlFor: (String?) -> String?,
    onRetry: () -> Unit,
    onSettings: () -> Unit,
    handlers: OrderHandlers?,
) {
    when (state) {
        OrderState.SignedOut -> SignedOutPlaceholder(stringResource(R.string.tab_up_next), onSettings)
        OrderState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        OrderState.Unreachable -> ErrorPlaceholder(stringResource(R.string.error_could_not_reach), onRetry)
        is OrderState.Loaded ->
            Refreshable(state = state, onRefresh = onRetry) {
                if (state.order.items.isEmpty()) {
                    EmptyPlaceholder(stringResource(R.string.order_empty))
                } else {
                    Rows(state, artUrlFor, handlers)
                }
            }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Rows(state: OrderState.Loaded, artUrlFor: (String?) -> String?, handlers: OrderHandlers?) {
    var historyOpen by rememberSaveable { mutableStateOf(false) }
    val ui = RunningOrderUiState(state.order.items, historyOpen)
    val listState = rememberLazyListState()

    // Opened on the row the order is read from, and moved to it again when it changes: the item on
    // air is the whole point of this tab and a long order buries it. Keyed on the anchor's id, so a
    // poll that changes nothing does not drag the list back from wherever the reader took it.
    val anchorId = ui.items.getOrNull(ui.anchorIndex)?.id
    LaunchedEffect(anchorId, historyOpen) {
        val at = ui.shown.indexOfFirst { it.id == anchorId }
        if (at >= 0) listState.scrollToItem(at)
    }

    var rating by remember { mutableStateOf<StationOrderItem?>(null) }

    Column(modifier = Modifier.fillMaxSize()) {
        if (state.stale) StaleBanner(state.lastGoodAtMs, modifier = Modifier.padding(horizontal = Gutter, vertical = 8.dp))

        ui.historyLabel?.let { label ->
            TextButton(onClick = { historyOpen = true }, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                Icon(painterResource(R.drawable.ic_expand_more), contentDescription = null, modifier = Modifier.size(18.dp))
                Text(label.resolve(), modifier = Modifier.padding(start = 8.dp))
            }
        }

        LazyColumn(state = listState, modifier = Modifier.fillMaxWidth().weight(1f)) {
            itemsIndexed(ui.shown, key = { _, item -> item.id }) { index, item ->
                val rateable = handlers != null && item.kind == StationOrderItemKind.TRACK && item.trackId != null
                Row(
                    item = item,
                    artworkUrl = artUrlFor(item.artworkUrl),
                    stale = state.stale,
                    modifier = if (rateable) Modifier.clickable { rating = item } else Modifier,
                )
                if (index < ui.shown.lastIndex) HorizontalDivider()
            }
        }
    }

    val sheetFor = rating
    val trackId = sheetFor?.trackId
    if (sheetFor != null && trackId != null && handlers != null) {
        // The row as it is NOW, so the control shows the rating the write just produced rather than
        // the one the sheet opened on.
        val current = ui.items.firstOrNull { it.id == sheetFor.id } ?: sheetFor
        ModalBottomSheet(onDismissRequest = { rating = null }) {
            Column(modifier = Modifier.padding(horizontal = Gutter).padding(bottom = 32.dp)) {
                Text(current.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    current.artists.joinToString(", "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                RatingControl(
                    rating = current.rating,
                    label = current.title,
                    busy = handlers.ratingTrackId == trackId,
                    onRate = { handlers.onRate(trackId, it) },
                    modifier = Modifier.padding(top = 16.dp),
                )
                // Said plainly, because it is not a favourite: it is the station's own curation mark.
                Text(
                    stringResource(R.string.rating_caption),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }
    }
}

@Composable
private fun Row(item: StationOrderItem, artworkUrl: String?, stale: Boolean, modifier: Modifier = Modifier) {
    val airing = item.state == StationItemState.AIRING
    ListItem(
        modifier = modifier.alpha(item.opacity()),
        leadingContent = {
            Box(modifier = Modifier.size(48.dp).clip(RoundedCornerShape(4.dp)), contentAlignment = Alignment.Center) {
                if (item.kind == StationOrderItemKind.SEGMENT || artworkUrl == null) {
                    Icon(
                        painterResource(if (item.kind == StationOrderItemKind.SEGMENT) R.drawable.ic_mic else R.drawable.ic_radio),
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    AsyncImage(model = artworkUrl, contentDescription = null, modifier = Modifier.fillMaxSize().alpha(if (stale) 0.4f else 1f))
                }
            }
        },
        headlineContent = {
            Text(item.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (airing) FontWeight.SemiBold else null)
        },
        supportingContent = {
            val credit = item.artists.joinToString(", ")
            val length = item.durationMs?.let(::clockOf)
            val line = listOfNotNull(credit.ifBlank { null }, length).joinToString(" · ")
            if (line.isNotEmpty()) Text(line, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        trailingContent = {
            item.stateLabel()?.let {
                Text(
                    it.resolve(),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (airing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
    )
}
