package com.maroonedsoftware.deadair.ui.add

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.clockOf
import com.maroonedsoftware.deadair.ui.ErrorPlaceholder
import com.maroonedsoftware.deadair.ui.LoadState
import com.maroonedsoftware.deadair.ui.catalog.Page
import com.maroonedsoftware.deadair.ui.catalog.detailFailure
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * Find a record in the library and put it in the running order.
 *
 * Every result is listed, including the ones the station has no audio for, because "do we have this
 * song?" is half of why the operator searched; those rows say so and offer nothing. There is no
 * confirmation: one record is a move-sized change, and `ConfirmAir` is kept for the actions that
 * change everything at a stroke.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddRecordScreen(
    typed: String,
    onTyped: (String) -> Unit,
    /** `null` before anything worth asking has been typed. */
    results: LoadState<Page<AddRow>>?,
    searching: Boolean,
    /** Whether Play next can be offered: it needs the running order, which may not have been read yet. */
    canPlayNext: Boolean,
    /** The row an add is under way for, which is the only row whose menu is closed to presses. */
    busyId: String?,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onPlayNext: (AddRow) -> Unit,
    onAddToEnd: (AddRow) -> Unit,
    snackbarHost: SnackbarHostState,
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHost) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.add_a_record)) },
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
                label = { Text(stringResource(R.string.search_by_title)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                modifier = Modifier.fillMaxWidth().padding(horizontal = Gutter, vertical = 8.dp),
            )
            // Always the same height, so the list does not jump each time a search starts.
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = Gutter)) {
                if (searching) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            when (results) {
                null -> Caption(stringResource(R.string.search_prompt))
                LoadState.Loading -> Unit
                is LoadState.Failed -> ErrorPlaceholder(detailFailure(results.status, R.string.search_nothing_found), onRetry)
                is LoadState.Loaded -> {
                    val page = results.value
                    if (page.items.isEmpty()) {
                        Caption(stringResource(R.string.search_nothing_found))
                    } else {
                        LazyColumn(modifier = Modifier.fillMaxSize()) {
                            itemsIndexed(page.items, key = { _, row -> row.id }) { index, row ->
                                ResultRow(
                                    row = row,
                                    canPlayNext = canPlayNext,
                                    enabled = busyId == null,
                                    onPlayNext = { onPlayNext(row) },
                                    onAddToEnd = { onAddToEnd(row) },
                                )
                                if (index < page.items.lastIndex) HorizontalDivider()
                            }
                            if (page.notShown > 0) {
                                item {
                                    Caption(pluralStringResource(R.plurals.search_not_shown, page.notShown.toInt(), page.notShown.toInt()))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ResultRow(row: AddRow, canPlayNext: Boolean, enabled: Boolean, onPlayNext: () -> Unit, onAddToEnd: () -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    ListItem(
        headlineContent = { Text(row.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = {
            val line = listOfNotNull(row.credit.ifBlank { null }, row.durationMs?.let(::clockOf)).joinToString(" · ")
            Column {
                if (line.isNotEmpty()) Text(line, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (!row.addable) Text(stringResource(R.string.record_not_here_yet), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        trailingContent = {
            // A row without its audio offers nothing: the station would refuse it at the door.
            if (row.addable) {
                Box {
                    IconButton(onClick = { menuOpen = true }, enabled = enabled) {
                        Icon(painterResource(R.drawable.ic_more_vert), contentDescription = stringResource(R.string.add_this_record, row.title))
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        if (canPlayNext) {
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.play_next)) },
                                onClick = {
                                    menuOpen = false
                                    onPlayNext()
                                },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.add_to_end)) },
                            onClick = {
                                menuOpen = false
                                onAddToEnd()
                            },
                        )
                    }
                }
            }
        },
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
