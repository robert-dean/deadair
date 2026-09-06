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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
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
    /** Move a planned row to a position in the whole order. */
    val onMove: (itemId: String, toIndex: Int) -> Unit,
    /** Drop a planned row. The position is the row's in the whole order at the moment of the tap, which is what an undo puts it back at. */
    val onRemove: (item: StationOrderItem, atIndex: Int) -> Unit,
    /** An action on a row is in flight. */
    val busyItemId: String?,
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
                val position = ui.positionOf(index)
                Row(
                    item = item,
                    artworkUrl = artUrlFor(item.artworkUrl),
                    stale = state.stale,
                    modifier = if (rateable) Modifier.clickable { rating = item } else Modifier,
                    // A menu only on a row the player has not been handed: an affordance that could
                    // only ever answer 422 is worse than none.
                    menu =
                        if (handlers == null || item.isSpent()) {
                            null
                        } else {
                            {
                                RowMenu(
                                    item = item,
                                    position = position,
                                    ui = ui,
                                    busy = handlers.busyItemId == item.id,
                                    onMove = handlers.onMove,
                                    onRemove = handlers.onRemove,
                                )
                            }
                        },
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

/**
 * The three moves and the drop, behind one button on the row.
 *
 * Play next moves the row in front of everything the player is not already holding, which is not
 * necessarily the next thing heard: whatever has been handed over plays first. Each move is offered
 * only where it lands somewhere, because a menu item whose only effect is nothing teaches an
 * operator that the menu does nothing.
 */
@Composable
private fun RowMenu(
    item: StationOrderItem,
    position: Int,
    ui: RunningOrderUiState,
    busy: Boolean,
    onMove: (String, Int) -> Unit,
    onRemove: (StationOrderItem, Int) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val moves =
        Move.entries.mapNotNull { move -> moveTarget(move, position, ui.firstPlannedIndex, ui.items.size)?.let { move to it } }

    Box {
        if (busy) {
            CircularProgressIndicator(modifier = Modifier.padding(12.dp).size(24.dp), strokeWidth = 2.dp)
        } else {
            IconButton(onClick = { open = true }) {
                Icon(painterResource(R.drawable.ic_more_vert), contentDescription = stringResource(R.string.row_actions, item.title))
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            moves.forEach { (move, target) ->
                DropdownMenuItem(
                    text = {
                        Text(
                            stringResource(
                                when (move) {
                                    Move.PLAY_NEXT -> R.string.play_next
                                    Move.UP -> R.string.move_up
                                    Move.DOWN -> R.string.move_down
                                },
                            ),
                        )
                    },
                    onClick = {
                        open = false
                        onMove(item.id, target)
                    },
                )
            }
            DropdownMenuItem(
                text = { Text(stringResource(R.string.drop), color = MaterialTheme.colorScheme.error) },
                onClick = {
                    open = false
                    onRemove(item, position)
                },
            )
        }
    }
}

@Composable
private fun Row(item: StationOrderItem, artworkUrl: String?, stale: Boolean, modifier: Modifier = Modifier, menu: (@Composable () -> Unit)? = null) {
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
            val label = item.stateLabel()
            if (menu != null) {
                menu()
            } else if (label != null) {
                Text(
                    label.resolve(),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (airing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
    )
}
