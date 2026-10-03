package com.maroonedsoftware.deadair.ui.request

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
import com.maroonedsoftware.deadair.AppGraph
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.auth.NotSignedInException
import com.maroonedsoftware.deadair.sdk.clients.SearchRequestableRecordsQuery
import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.add.SEARCH_DEBOUNCE_MS
import com.maroonedsoftware.deadair.ui.add.searchTerm
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Asking the station for a record, wired.
 *
 * The search is the Add-a-record search's debounce over the request route rather than the library:
 * it answers only records a request could get, so there is no row to draw that would be refused at
 * the door. The listener's own requests are polled while the page shows, because the station tells
 * an app nothing when one moves on; `/requests/mine` is the only way to find out.
 *
 * A send that the station refuses is still a 201, and is said as the station said it.
 */
@Composable
fun RequestRoute(graph: AppGraph, onBack: () -> Unit) {
    var typed by rememberSaveable { mutableStateOf("") }
    val term = searchTerm(typed)
    var results by remember { mutableStateOf<LoadState<List<RequestRow>>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(term, attempt) {
        if (term == null) {
            results = null
            return@LaunchedEffect
        }
        delay(SEARCH_DEBOUNCE_MS)
        searching = true
        try {
            val list = graph.sessions.withSession { it.requests.searchRequestableRecords(SearchRequestableRecordsQuery(q = term, limit = REQUEST_SEARCH_LIMIT)) }
            results = LoadState.Loaded(list.tracks.mapNotNull(RequestRow::of))
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

    // A failed poll keeps the last list up rather than blanking it: the next one is fifteen seconds off.
    var mine by remember { mutableStateOf<LoadState<List<MyRequestRow>>?>(null) }
    var mineAttempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(mineAttempt) {
        while (true) {
            try {
                val list = graph.sessions.withSession { it.requests.listMyRequests() }
                val now = System.currentTimeMillis()
                val zone = ZoneId.systemDefault()
                mine = LoadState.Loaded(list.requests.map { MyRequestRow.of(it, now, zone) })
            } catch (error: CancellationException) {
                throw error
            } catch (error: NotSignedInException) {
                if (mine !is LoadState.Loaded) mine = LoadState.Failed(UNAUTHORIZED)
            } catch (error: SdkError) {
                if (mine !is LoadState.Loaded) mine = LoadState.Failed(error.status)
            } catch (error: Exception) {
                if (mine !is LoadState.Loaded) mine = LoadState.Failed(null)
            }
            delay(MY_REQUESTS_POLL_MS)
        }
    }

    val scope = rememberCoroutineScope()
    val snackbarHost = remember { SnackbarHostState() }
    var chosen by remember { mutableStateOf<RequestRow?>(null) }
    var form by remember { mutableStateOf(RequestForm()) }
    var sending by remember { mutableStateOf(false) }

    // The station's answer is a Message, and its words are only to be had in composition.
    var outcome by remember { mutableStateOf<Message?>(null) }
    val outcomeWords = outcome?.resolve()
    LaunchedEffect(outcome) {
        if (outcomeWords != null) {
            snackbarHost.showSnackbar(outcomeWords)
            outcome = null
        }
    }

    val gone = stringResource(R.string.request_record_gone)
    val unreachable = stringResource(R.string.error_could_not_reach)
    val refusedWith = stringResource(R.string.notice_failed)

    fun send(row: RequestRow) {
        if (sending) return
        sending = true
        scope.launch {
            try {
                val request = graph.sessions.withSession { it.requests.createRequest(form.body(row.id)) }
                chosen = null
                // The name is who the listener is, so it stays for the next one; the rest was for this record.
                form = RequestForm(name = form.name)
                typed = ""
                mineAttempt += 1
                outcome = requestOutcome(request)
            } catch (error: CancellationException) {
                throw error
            } catch (error: SdkError) {
                if (error.status == NOT_FOUND) {
                    chosen = null
                    attempt += 1
                    snackbarHost.showSnackbar(gone)
                } else {
                    snackbarHost.showSnackbar(refusedWith.format(error.status))
                }
            } catch (error: Exception) {
                snackbarHost.showSnackbar(unreachable)
            } finally {
                sending = false
            }
        }
    }

    RequestScreen(
        typed = typed,
        onTyped = { typed = it },
        results = results,
        searching = searching,
        mine = mine,
        onBack = onBack,
        onRetry = { attempt += 1 },
        onRetryMine = { mineAttempt += 1 },
        onChoose = { chosen = it },
        chosen = chosen,
        form = form,
        onForm = { form = it },
        sending = sending,
        onSend = ::send,
        onDismiss = { if (!sending) chosen = null },
        snackbarHost = snackbarHost,
    )
}

private const val UNAUTHORIZED = 401
private const val NOT_FOUND = 404
