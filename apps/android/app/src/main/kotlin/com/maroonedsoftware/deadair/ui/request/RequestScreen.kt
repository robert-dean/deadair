package com.maroonedsoftware.deadair.ui.request

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.catalog.detailFailure
import com.maroonedsoftware.deadair.ui.text.Message
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * Find a record and ask the station to play it.
 *
 * With nothing typed the page is the listener's own requests, newest first, because "did it play
 * yet?" is the other half of why somebody opens it. A row opens a sheet rather than sending at once:
 * a request is one at a time and cannot be taken back, and the sheet is where the name and the
 * dedication go.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RequestScreen(
    typed: String,
    onTyped: (String) -> Unit,
    /** `null` before anything worth asking has been typed. */
    results: LoadState<List<RequestRow>>?,
    searching: Boolean,
    /** `null` until the first answer. */
    mine: LoadState<List<MyRequestRow>>?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onRetryMine: () -> Unit,
    onChoose: (RequestRow) -> Unit,
    /** The record the sheet is open for, or `null` with the sheet closed. */
    chosen: RequestRow?,
    form: RequestForm,
    onForm: (RequestForm) -> Unit,
    sending: Boolean,
    onSend: (RequestRow) -> Unit,
    onDismiss: () -> Unit,
    snackbarHost: SnackbarHostState,
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHost) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.request_a_record)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)) {
            OutlinedTextField(
                value = typed,
                onValueChange = onTyped,
                label = { Text(stringResource(R.string.request_search_hint)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth().padding(horizontal = Gutter, vertical = 8.dp),
            )
            // Always the same height, so the list does not jump each time a search starts.
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = Gutter)) {
                if (searching) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            when (results) {
                null -> MyRequests(mine, onRetryMine)
                LoadState.Loading -> Unit
                is LoadState.Failed -> ErrorPlaceholder(detailFailure(results.status, R.string.request_nothing_found), onRetry)
                is LoadState.Loaded ->
                    if (results.value.isEmpty()) {
                        Caption(stringResource(R.string.request_nothing_found))
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            itemsIndexed(results.value, key = { _, row -> row.id }) { index, row ->
                                ListItem(
                                    headlineContent = { Text(row.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                    supportingContent = {
                                        Column {
                                            Text(listOfNotNull(row.artist, row.detail).joinToString(" · "), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                            // A record the station would take in first says where from.
                                            row.sourceName?.let {
                                                Text(
                                                    stringResource(R.string.request_from_provider, it),
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                )
                                            }
                                        }
                                    },
                                    trailingContent = { Icon(painterResource(R.drawable.ic_playlist_add), contentDescription = null) },
                                    modifier =
                                        Modifier.clickable(onClickLabel = stringResource(R.string.request_this_record, row.title)) { onChoose(row) },
                                )
                                if (index < results.value.lastIndex) HorizontalDivider()
                            }
                        }
                    }
            }
        }
    }

    if (chosen != null) RequestSheet(chosen, form, onForm, sending, onSend = { onSend(chosen) }, onDismiss = onDismiss)
}

@Composable
private fun MyRequests(mine: LoadState<List<MyRequestRow>>?, onRetry: () -> Unit) {
    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item { Caption(stringResource(R.string.request_intro)) }
        item {
            Text(
                stringResource(R.string.my_requests),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Gutter).padding(top = 8.dp),
            )
        }
        when (mine) {
            null, LoadState.Loading -> Unit
            is LoadState.Failed -> item { ErrorPlaceholder(detailFailure(mine.status, R.string.my_requests_none), onRetry) }
            is LoadState.Loaded -> myRows(mine.value)
        }
    }
}

private fun LazyListScope.myRows(rows: List<MyRequestRow>) {
    if (rows.isEmpty()) {
        item { Caption(stringResource(R.string.my_requests_none)) }
        return
    }
    itemsIndexed(rows, key = { _, row -> row.id }) { index, row ->
        val open = isOpen(row.status)
        ListItem(
            headlineContent = { Text(row.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            supportingContent = {
                Column {
                    Text(row.artist, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    row.note?.let { Text(it.resolve(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            },
            trailingContent = {
                Text(
                    Message.RequestState(row.status).resolve(),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (open) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
        )
        if (index < rows.lastIndex) HorizontalDivider()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RequestSheet(row: RequestRow, form: RequestForm, onForm: (RequestForm) -> Unit, sending: Boolean, onSend: () -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = Gutter).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(stringResource(R.string.request_this_record, row.title), style = MaterialTheme.typography.titleMedium)
            Text(row.artist, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SheetField(
                value = form.name,
                onValue = { onForm(form.copy(name = it.take(REQUEST_NAME_MAX))) },
                label = R.string.request_your_name,
                hint = R.string.request_your_name_hint,
                enabled = !sending,
            )
            SheetField(
                value = form.dedicateTo,
                onValue = { onForm(form.copy(dedicateTo = it.take(REQUEST_DEDICATE_MAX))) },
                label = R.string.request_dedicate_to,
                hint = null,
                enabled = !sending,
            )
            SheetField(
                value = form.message,
                onValue = { onForm(form.copy(message = it.take(REQUEST_MESSAGE_MAX))) },
                label = R.string.request_message,
                hint = R.string.request_message_hint,
                enabled = !sending,
                singleLine = false,
            )
            Button(onClick = onSend, enabled = !sending, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text(stringResource(R.string.request_send))
            }
        }
    }
}

@Composable
private fun SheetField(value: String, onValue: (String) -> Unit, label: Int, hint: Int?, enabled: Boolean, singleLine: Boolean = true) {
    OutlinedTextField(
        value = value,
        onValueChange = onValue,
        label = { Text(stringResource(label)) },
        supportingText = hint?.let { { Text(stringResource(it)) } },
        enabled = enabled,
        singleLine = singleLine,
        minLines = if (singleLine) 1 else 2,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun Caption(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(horizontal = Gutter, vertical = 16.dp),
    )
}
