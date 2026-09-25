package com.maroonedsoftware.deadair.ui.order

import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.zIndex
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.maroonedsoftware.deadair.ui.nowplaying.CoverColored
import com.maroonedsoftware.deadair.ui.nowplaying.rememberCoverPalette
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
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
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
import com.maroonedsoftware.deadair.sdk.models.Persona
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.nowplaying.clockOf
import com.maroonedsoftware.deadair.sdk.models.StationItemState
import com.maroonedsoftware.deadair.sdk.models.StationOrderItem
import com.maroonedsoftware.deadair.sdk.models.StationOrderItemKind
import com.maroonedsoftware.deadair.ui.EmptyPlaceholder
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.Refreshable
import com.maroonedsoftware.deadair.ui.SignedOutPlaceholder
import com.maroonedsoftware.deadair.ui.StaleBanner
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.Gutter

/** What an operator can do to a row. `null` for anyone else, and the rows are then only read. */
data class OrderHandlers(
    /** Move a planned row to a position in the whole order. */
    val onMove: (itemId: String, toIndex: Int) -> Unit,
    /** Drop a planned row. The position is the row's in the whole order at the moment of the tap, which is what an undo puts it back at. */
    val onRemove: (item: StationOrderItem, atIndex: Int) -> Unit,
    /** An action on a row is in flight. */
    val busyItemId: String?,
    /** Hand the broadcast to a persona, or to the station's own host with `null`. */
    val onRecast: (String?) -> Unit,
    /** Change what the station plays: this show from here on, or a new one. */
    val onPlan: () -> Unit,
    /** Any operator action is in flight, which is what stops a second one being started. */
    val busy: Boolean,
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
    onSignIn: () -> Unit,
    /** Open a record's page. Every record row leads there, which is also where its rating lives. */
    onTrack: (String) -> Unit,
    /** Open a break's attempts: what the station said, or tried to, in that slot. */
    onSegment: (String) -> Unit,
    /** Open everything the station has played, beyond this broadcast. */
    onHistory: () -> Unit,
    /** The broadcast the order belongs to, for the header. `null` before the order has arrived. */
    broadcast: BroadcastUiState?,
    /** The station's characters, for the host picker. Read once when the tab opens. */
    personas: LoadState<List<Persona>>,
    onReloadPersonas: () -> Unit,
    handlers: OrderHandlers?,
    /** What the station calls itself, for the header. */
    stationName: String,
    /** The cover on air, whose colours the tab wears. `null` off air, or before the reading has arrived. */
    onAirArtworkUrl: String?,
    /** The tab's actions, beside its heading. */
    actions: @Composable RowScope.() -> Unit,
) {
    // The tab wears the on-air cover's colours, as Now playing does: its accent on the on-air row
    // and the host chip, and its mesh behind the heading.
    val palette = rememberCoverPalette(onAirArtworkUrl, darkPage = MaterialTheme.colorScheme.background.luminance() < 0.5f)
    CoverColored(palette?.accent) {
        Column(modifier = Modifier.fillMaxSize()) {
            UpNextHeader(stationName = stationName, mesh = palette?.mesh.orEmpty(), actions = actions)
            Box(modifier = Modifier.fillMaxWidth().weight(1f)) { Body(state, artUrlFor, onRetry, onSignIn, onTrack, onSegment, onHistory, broadcast, personas, onReloadPersonas, handlers) }
        }
    }
}

@Composable
private fun Body(
    state: OrderState,
    artUrlFor: (String?) -> String?,
    onRetry: () -> Unit,
    onSignIn: () -> Unit,
    onTrack: (String) -> Unit,
    onSegment: (String) -> Unit,
    onHistory: () -> Unit,
    broadcast: BroadcastUiState?,
    personas: LoadState<List<Persona>>,
    onReloadPersonas: () -> Unit,
    handlers: OrderHandlers?,
) {
    when (state) {
        OrderState.SignedOut -> SignedOutPlaceholder(stringResource(R.string.tab_up_next), onSignIn)
        OrderState.Loading -> Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        OrderState.Unreachable -> ErrorPlaceholder(stringResource(R.string.error_could_not_reach), onRetry)
        is OrderState.Loaded ->
            Refreshable(state = state, onRefresh = onRetry) {
                Column(modifier = Modifier.fillMaxSize()) {
                    // Drawn even with nothing on: off air it is the only thing on this tab with
                    // anything to say, and the station's empty order is an ordinary answer.
                    broadcast?.let {
                        BroadcastHeader(
                            ui = it,
                            personas = personas,
                            onReloadPersonas = onReloadPersonas,
                            onRecast = handlers?.onRecast,
                            onPlan = handlers?.onPlan,
                            busy = handlers?.busy == true,
                        )
                    }
                    if (state.order.items.isEmpty()) {
                        Box(modifier = Modifier.weight(1f)) { EmptyPlaceholder(stringResource(R.string.order_empty)) }
                    } else {
                        Rows(state, artUrlFor, onTrack, onSegment, onHistory, handlers, modifier = Modifier.weight(1f))
                    }
                }
            }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Rows(
    state: OrderState.Loaded,
    artUrlFor: (String?) -> String?,
    onTrack: (String) -> Unit,
    onSegment: (String) -> Unit,
    onHistory: () -> Unit,
    handlers: OrderHandlers?,
    modifier: Modifier = Modifier,
) {
    var historyOpen by rememberSaveable { mutableStateOf(false) }
    val ui = RunningOrderUiState(state.order.items, historyOpen)
    val listState = rememberLazyListState()

    // A row being dragged, and after it is let go the order it was left in, held until the station's
    // answer replaces the order: without it the list snapped back to the old order for the moment
    // the move was in flight, and then jumped forward again.
    var drag by remember { mutableStateOf<Drag?>(null) }
    var held by remember { mutableStateOf<List<StationOrderItem>?>(null) }
    LaunchedEffect(state.order.items) { held = null }
    val bounds = if (handlers == null) null else ui.dragBounds()
    val base = held ?: ui.shown
    val rows = drag?.let { base.moved(it.from, it.at) } ?: base

    // Opened on the row the order is read from, and moved to it again when it changes: the item on
    // air is the whole point of this tab and a long order buries it. Keyed on the anchor's id, so a
    // poll that changes nothing does not drag the list back from wherever the reader took it.
    val anchorId = ui.items.getOrNull(ui.anchorIndex)?.id
    LaunchedEffect(anchorId, historyOpen) {
        val at = ui.shown.indexOfFirst { it.id == anchorId }
        if (at >= 0) listState.scrollToItem(at)
    }

    Column(modifier = modifier.fillMaxSize()) {
        if (state.stale) StaleBanner(state.lastGoodAtMs, modifier = Modifier.padding(horizontal = Gutter, vertical = 8.dp))

        // One slot above the list: the fold while there is one, and once it is open (or there was
        // nothing to fold) the way further back, to everything the station has played. In the same
        // place either way, so History is always one tap from here and never moves the rows.
        val label = ui.historyLabel
        if (label != null) {
            TextButton(onClick = { historyOpen = true }, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                Icon(painterResource(R.drawable.ic_expand_more), contentDescription = null, modifier = Modifier.size(18.dp))
                Text(label.resolve(), modifier = Modifier.padding(start = 8.dp))
            }
        } else {
            TextButton(onClick = onHistory, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                Icon(painterResource(R.drawable.ic_history), contentDescription = null, modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.history_link), modifier = Modifier.padding(start = 8.dp))
            }
        }

        LazyColumn(state = listState, modifier = Modifier.fillMaxWidth().weight(1f)) {
            itemsIndexed(rows, key = { _, item -> item.id }) { index, item ->
                val trackId = item.trackId?.takeIf { item.kind == StationOrderItemKind.TRACK }
                val segmentId = item.segmentId?.takeIf { item.kind == StationOrderItemKind.SEGMENT }
                val position = ui.positionOf(index)
                val dragged = drag?.takeIf { it.id == item.id }
                OrderRow(
                    item = item,
                    artworkUrl = artUrlFor(item.artworkUrl),
                    stale = state.stale,
                    // The dragged row rides on the finger above the others; the others slide aside
                    // as it passes them. It is the one row not animated into place, since its place
                    // is wherever the finger is.
                    lift =
                        if (dragged != null) {
                            Modifier.zIndex(1f).graphicsLayer {
                                translationY = dragged.offset
                                shadowElevation = 12.dp.toPx()
                                shape = RoundedCornerShape(16.dp)
                                clip = true
                            }.background(MaterialTheme.colorScheme.surfaceContainerHighest)
                        } else {
                            Modifier.animateItem()
                        },
                    handle =
                        if (bounds == null || item.isSpent() || handlers?.busy == true) {
                            null
                        } else {
                            {
                                DragHandle(
                                    title = item.title,
                                    onStart = { if (drag == null) drag = Drag(item.id, index) },
                                    onDrag = { dy ->
                                        val live = drag ?: return@DragHandle
                                        live.offset += dy
                                        stepPast(live, listState, bounds)
                                    },
                                    onEnd = {
                                        val done = drag ?: return@DragHandle
                                        drag = null
                                        if (done.at != done.from) {
                                            held = base.moved(done.from, done.at)
                                            // Stated against the WHOLE order, where the row now sits.
                                            handlers?.onMove?.invoke(done.id, ui.positionOf(done.at))
                                        }
                                    },
                                )
                            }
                        },
                    modifier =
                        when {
                            trackId != null -> Modifier.clickable { onTrack(trackId) }
                            segmentId != null -> Modifier.clickable { onSegment(segmentId) }
                            else -> Modifier
                        },
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

/**
 * One item in the order: its picture, its title and credit, and its length, or on the item that is
 * airing a moving level meter in the station's colour in place of the length, on a card of its own
 * so it is the row the eye lands on.
 */
@Composable
private fun OrderRow(
    item: StationOrderItem,
    artworkUrl: String?,
    stale: Boolean,
    modifier: Modifier = Modifier,
    /** Where the row sits among the others: lifted while it is dragged, animated into place otherwise. */
    lift: Modifier = Modifier,
    menu: (@Composable () -> Unit)? = null,
    handle: (@Composable () -> Unit)? = null,
) {
    val airing = item.state == StationItemState.AIRING
    val card = RoundedCornerShape(16.dp)
    Row(
        modifier =
            lift
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 2.dp)
                .clip(card)
                .then(if (airing) Modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh) else Modifier)
                .then(modifier)
                .alpha(item.opacity())
                .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(modifier = Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surfaceContainer), contentAlignment = Alignment.Center) {
            // The picture first, whatever the row is. A break wears the picture its KIND was
            // given — the sky on a forecast, the front page on a bulletin — and the console
            // draws the same one against the same row, so forcing the microphone here on the
            // grounds that a segment is not a record would leave the phone and the desk
            // disagreeing about an order they are both reading from the station.
            if (artworkUrl == null) {
                Icon(
                    painterResource(if (item.kind == StationOrderItemKind.SEGMENT) R.drawable.ic_mic else R.drawable.ic_radio),
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                AsyncImage(model = artworkUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().alpha(if (stale) 0.4f else 1f))
            }
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(item.title, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
            val credit = item.artists.joinToString(", ")
            if (credit.isNotBlank()) {
                Text(credit, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        val label = item.stateLabel()
        when {
            airing -> OnAirMeter(moving = !stale, label = label?.resolve())
            // A row that has been handed over, played or skipped says so where the length was:
            // what happened to it is the news, and its length no longer matters.
            label != null -> Text(label.resolve(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> item.durationMs?.let { Text(clockOf(it), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        menu?.invoke()
        handle?.invoke()
    }
}

/** A row being dragged: where it started, where it would land now, and how far the finger has it from its slot. */
private class Drag(val id: String, val from: Int) {
    var at by mutableIntStateOf(from)
    var offset by mutableFloatStateOf(0f)
}

/**
 * Move the dragged row one place when its middle has passed a neighbour's, and take that neighbour's
 * height off the finger's offset so the row stays under the finger as its slot moves. Only when the
 * list has been laid out with the row where [Drag.at] says it is: a second step read against a
 * layout from before the first would move it two places for one.
 */
private fun stepPast(drag: Drag, list: LazyListState, bounds: IntRange) {
    val visible = list.layoutInfo.visibleItemsInfo
    val me = visible.firstOrNull { it.key == drag.id } ?: return
    if (me.index != drag.at) return
    val middle = me.offset + me.size / 2 + drag.offset
    val below = visible.firstOrNull { it.index == me.index + 1 }
    val above = visible.firstOrNull { it.index == me.index - 1 }
    when {
        below != null && drag.at < bounds.last && middle > below.offset + below.size / 2 -> {
            drag.at += 1
            drag.offset -= below.size
        }
        above != null && drag.at > bounds.first && middle < above.offset + above.size / 2 -> {
            drag.at -= 1
            drag.offset += above.size
        }
    }
}

/**
 * The handle a row is dragged by. Only the handle starts a drag, so a thumb scrolling the list
 * never picks a row up by accident. It names what it moves for a screen reader, which moves rows
 * through the row's menu instead.
 */
@Composable
private fun DragHandle(title: String, onStart: () -> Unit, onDrag: (Float) -> Unit, onEnd: () -> Unit) {
    // The gesture outlives a recomposition, so it calls whatever the row's callbacks are NOW: read
    // at the time it was set up, a row that had moved started its next drag from where it used to be.
    val start by rememberUpdatedState(onStart)
    val move by rememberUpdatedState(onDrag)
    val end by rememberUpdatedState(onEnd)
    Icon(
        painterResource(R.drawable.ic_drag_handle),
        contentDescription = stringResource(R.string.drag_to_reorder, title),
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier =
            Modifier.size(40.dp)
                .pointerInput(title) {
                    detectDragGestures(
                        onDragStart = { start() },
                        onDrag = { change, amount ->
                            change.consume()
                            move(amount.y)
                        },
                        onDragEnd = { end() },
                        onDragCancel = { end() },
                    )
                }.padding(8.dp),
    )
}

/**
 * The on-air mark: three bars rising and falling in a disc of the station's colour, the level meter
 * every player uses for "this one". It says "On air" to a screen reader, which is what it means, and
 * it stands still while the reading is stale, since a meter moving over a record that may have ended
 * would be a confident lie.
 */
@Composable
private fun OnAirMeter(moving: Boolean, label: String?) {
    val bars = rememberInfiniteTransition(label = "meter")
    val heights =
        METER_TEMPOS.mapIndexed { index, tempo ->
            if (moving) {
                bars.animateFloat(
                    initialValue = 0.3f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(tempo, delayMillis = index * 90), RepeatMode.Reverse),
                    label = "bar$index",
                ).value
            } else {
                METER_RESTING[index]
            }
        }
    val fill = MaterialTheme.colorScheme.primary
    val ink = MaterialTheme.colorScheme.onPrimary
    Canvas(
        modifier =
            Modifier.size(32.dp).background(fill, CircleShape).semantics {
                if (label != null) contentDescription = label
            },
    ) {
        val bar = 3.dp.toPx()
        val gap = 3.dp.toPx()
        val tallest = size.height * 0.46f
        val left = (size.width - (bar * 3 + gap * 2)) / 2
        val floor = size.height / 2 + tallest / 2
        heights.forEachIndexed { index, share ->
            val height = tallest * share
            drawRoundRect(ink, topLeft = Offset(left + index * (bar + gap), floor - height), size = Size(bar, height), cornerRadius = CornerRadius(bar / 2))
        }
    }
}

/** How long each bar takes to rise, never in step with the others. */
private val METER_TEMPOS = listOf(420, 560, 480)

/** Where the bars stand when the meter is still. */
private val METER_RESTING = listOf(0.55f, 0.9f, 0.7f)
