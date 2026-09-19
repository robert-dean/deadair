package com.maroonedsoftware.deadair.ui.add

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.NotSignedInException
import com.maroonedsoftware.deadair.director.OrderState
import com.maroonedsoftware.deadair.sdk.models.PaginationSort
import com.maroonedsoftware.deadair.sdk.models.TrackQueryInput
import com.maroonedsoftware.deadair.sdk.models.TrackSort
import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.ShowOperatorNotices
import com.maroonedsoftware.deadair.ui.catalog.PAGE_MAX
import com.maroonedsoftware.deadair.ui.catalog.Page
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The library search, wired.
 *
 * Not `rememberDetail`, although it is one read: keyed on the term, that blanks the list to a
 * spinner on every letter. The last answer stays up while the next is fetched, and the box is never
 * written back from an answer, which would fight the typing whenever one landed mid-word.
 *
 * An add keeps the operator here rather than popping to Home, because adding three records is one
 * errand. That is also why this screen says "Added" itself: the running order underneath cannot be
 * seen from here.
 */
@Composable
fun AddRecordRoute(graph: AppGraph, onBack: () -> Unit) {
    var typed by rememberSaveable { mutableStateOf("") }
    val term = searchTerm(typed)
    var results by remember { mutableStateOf<LoadState<Page<AddRow>>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }

    // Keyed on the term, so each new letter cancels the wait for the last one: that is the debounce.
    LaunchedEffect(term, attempt) {
        if (term == null) {
            results = null
            return@LaunchedEffect
        }
        delay(SEARCH_DEBOUNCE_MS)
        searching = true
        try {
            val page =
                graph.sessions.withSession {
                    it.catalog.listTracks(TrackQueryInput(page = 0, pageSize = PAGE_MAX, search = term, sortBy = TrackSort.TITLE, sort = PaginationSort.ASC))
                }
            results = LoadState.Loaded(Page(page.data.map(AddRow::of), page.meta.total))
        } catch (error: CancellationException) {
            throw error
        } catch (error: NotSignedInException) {
            results = LoadState.Failed(UNAUTHORIZED)
        } catch (error: SdkError) {
            results = LoadState.Failed(error.status)
        } catch (error: Exception) {
            results = LoadState.Failed(null)
        } finally {
            searching = false
        }
    }

    // Read here so Play next knows the first position the station will take, and so the order the
    // add answers with is the one the Up next tab finds on the way back.
    val order by graph.order.state.collectAsStateWithLifecycle()
    val items = (order as? OrderState.Loaded)?.order?.items

    val scope = rememberCoroutineScope()
    var busyId by remember { mutableStateOf<String?>(null) }
    val snackbarHost = remember { SnackbarHostState() }
    ShowOperatorNotices(graph.operator.notices, snackbarHost)
    val addedWords = stringResource(R.string.record_added)

    fun add(row: AddRow, atIndex: Int?) {
        if (busyId != null) return
        busyId = row.id
        scope.launch {
            try {
                if (graph.orderActions.addTrack(row.id, atIndex)) snackbarHost.showSnackbar(addedWords.format(row.title))
            } finally {
                busyId = null
            }
        }
    }

    AddRecordScreen(
        typed = typed,
        onTyped = { typed = it },
        results = results,
        searching = searching,
        canPlayNext = items != null,
        busyId = busyId,
        onBack = onBack,
        onRetry = { attempt += 1 },
        onPlayNext = { row -> add(row, items?.let(::playNextIndex)) },
        onAddToEnd = { row -> add(row, null) },
        snackbarHost = snackbarHost,
    )
}

private const val UNAUTHORIZED = 401
