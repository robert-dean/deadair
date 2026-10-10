package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.LyricsUiState
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * The words of the record being heard, over Now playing.
 *
 * Timed lines light the one being sung and keep it in view, a couple of lines from the top so what
 * comes next is visible beneath it. The scroll waits while the listener is dragging, so reading ahead
 * is not snatched back. The words are the station's, shown exactly as they came; only the title and
 * the credit under them are this app's.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LyricsSheet(state: LyricsUiState, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = Gutter).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.lyrics), style = MaterialTheme.typography.titleMedium)
            when (state) {
                is LyricsUiState.Synced -> SyncedLines(state)
                is LyricsUiState.Plain ->
                    Text(
                        state.text,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.fillMaxWidth().heightIn(max = SheetTextHeight).verticalScroll(rememberScrollState()),
                    )
                LyricsUiState.Hidden -> Unit
            }
            provider(state)?.let {
                Text(stringResource(R.string.lyrics_from, it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SyncedLines(state: LyricsUiState.Synced) {
    val list = rememberLazyListState()
    LaunchedEffect(state.current) {
        val current = state.current ?: return@LaunchedEffect
        if (!list.isScrollInProgress) list.animateScrollToItem((current - LinesAbove).coerceAtLeast(0))
    }
    LazyColumn(state = list, modifier = Modifier.fillMaxWidth().heightIn(max = SheetTextHeight), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        itemsIndexed(state.lines) { index, line ->
            val lit = index == state.current
            val color by animateColorAsState(
                if (lit) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                label = "lyric",
            )
            Text(
                line.text,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = if (lit) FontWeight.SemiBold else FontWeight.Normal,
                color = color,
            )
        }
    }
}

private fun provider(state: LyricsUiState): String? =
    when (state) {
        is LyricsUiState.Synced -> state.provider
        is LyricsUiState.Plain -> state.provider
        LyricsUiState.Hidden -> null
    }

/** How tall the words may grow before they scroll, so the sheet never covers the whole screen. */
private val SheetTextHeight = 460.dp

/** How many lines stay above the lit one as it is scrolled to. */
private const val LinesAbove = 2
