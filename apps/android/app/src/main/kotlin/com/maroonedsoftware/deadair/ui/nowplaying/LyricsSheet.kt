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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.LyricsUiState
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * The words of the record being heard, over Now playing.
 *
 * Timed lines light the one being sung and keep it in view, a couple of lines from the top so what
 * comes next is visible beneath it. When the source timed its words, the part of that line already
 * sung is painted in the accent with a soft glow, word by word; a line timed only as a line is lit
 * whole, as it always was. The scroll waits while the listener is dragging, so reading ahead
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
            val sung = state.sung?.takeIf { lit }
            if (sung == null) {
                Text(
                    line.text,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = if (lit) FontWeight.SemiBold else FontWeight.Normal,
                    color = color,
                )
            } else {
                Text(sungText(line.text, sung, MaterialTheme.colorScheme.primary), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = color)
            }
        }
    }
}

/**
 * A line with its first [sung] characters in [accent] and a soft glow of the same colour, the rest in
 * the line's own colour. The glow is a blurred shadow with no offset, so it reads as light around the
 * letters rather than as depth.
 */
private fun sungText(text: String, sung: Int, accent: Color): AnnotatedString =
    buildAnnotatedString {
        withStyle(SpanStyle(color = accent, shadow = Shadow(color = accent.copy(alpha = GlowAlpha), offset = Offset.Zero, blurRadius = GlowRadius))) {
            append(text.take(sung))
        }
        append(text.drop(sung))
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

/** How strong the glow behind the sung words is, and how far it spreads in pixels. */
private const val GlowAlpha = 0.55f
private const val GlowRadius = 14f
