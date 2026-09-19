package com.maroonedsoftware.deadair.ui.catalog

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.SessionState
import com.maroonedsoftware.deadair.director.OrderState
import com.maroonedsoftware.deadair.sdk.models.TrackDetail
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.add.playNextIndex
import kotlinx.coroutines.launch

/**
 * What the record page offers the operator for putting this record on.
 *
 * `canPlayNext` is false until the running order has been read, because Play next is a position in
 * it. `hasAudio` false draws the buttons disabled with the reason beside them.
 */
data class AddToOrderHandler(
    val busy: Boolean,
    val hasAudio: Boolean,
    val canPlayNext: Boolean,
    val onPlayNext: () -> Unit,
    val onAddToEnd: () -> Unit,
)

/**
 * Whether the station holds this record's audio, as far as a record's own page can tell.
 *
 * The library list is told outright (`TrackRow.hasAudio`, which reads the stored checksum). The
 * page is not, and the nearest thing it carries is a copy's byte count, which only a fetch that
 * landed writes. If the two ever disagree the station still decides, and its 422 says so.
 */
fun TrackDetail.hasLocalAudio(): Boolean = bindings.any { it.byteSize != null }

/**
 * The operator's Play next and Add to the end for a record page, or nothing for anyone else.
 *
 * The page stays where it is after an add and says so in its own snackbar, for the reason every
 * pushed page does: a notice posted to Home on the way out is posted to nobody.
 */
@Composable
fun rememberAddToOrder(graph: AppGraph, detail: Detail<TrackDetail>, snackbarHost: SnackbarHostState): AddToOrderHandler? {
    val session by graph.sessions.state.collectAsStateWithLifecycle()
    val isOperator = (session as? SessionState.SignedIn)?.isOperator == true
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    val addedWords = stringResource(R.string.record_added)
    val loaded = detail.state as? LoadState.Loaded
    if (!isOperator || loaded == null) return null

    // Collected only for the operator, so a listener's record page does not start the order poll.
    val order by graph.order.state.collectAsStateWithLifecycle()
    val items = (order as? OrderState.Loaded)?.order?.items
    val record = loaded.value

    fun add(atIndex: Int?) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                if (graph.orderActions.addTrack(record.id.toString(), atIndex)) snackbarHost.showSnackbar(addedWords.format(record.title))
            } finally {
                busy = false
            }
        }
    }

    return AddToOrderHandler(
        busy = busy,
        hasAudio = record.hasLocalAudio(),
        canPlayNext = items != null,
        onPlayNext = { add(items?.let(::playNextIndex)) },
        onAddToEnd = { add(null) },
    )
}
