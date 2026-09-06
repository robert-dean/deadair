package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.Playhead
import com.maroonedsoftware.deadair.nowplaying.clockOf
import com.maroonedsoftware.deadair.ui.CentredColumn
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.ArtworkMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * What is on air, and a button.
 *
 * There is no queue and no scrubber, because a listener has neither — the station decides what
 * plays next and there is no going back. What the station HAS played is a tab of its own; this one
 * is the present tense.
 *
 * It carries no `Scaffold` and no app bar of its own. The station's name and the settings button
 * belong to the frame every tab shares, so switching tabs does not redraw them and the title cannot
 * sit a few pixels differently on one screen than on another.
 *
 * ## Two layouts, one screen
 *
 * Upright, the cover sits above the words and the button. Sideways, or on anything wide enough
 * to be a tablet, the cover sits beside them. That is not a nicety: a full-width square in
 * landscape is as tall as the screen, and the first version of this measured the play button out
 * of existence there. The same thing happened upright at the largest accessibility text size,
 * which is why both layouts scroll when their content outgrows them.
 */
@Composable
fun NowPlayingScreen(
    state: NowPlayingUiState,
    artworkUrl: String?,
    playhead: Playhead?,
    onPlay: () -> Unit,
    onStop: () -> Unit,
    /** Where the fallback note leads: the format picker, which is where the fact it states can be changed. */
    onOpenFormat: () -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val viewportHeight = maxHeight
        val sideBySide = maxWidth > maxHeight || maxWidth >= WIDE

        if (sideBySide) {
            Row(
                modifier = Modifier.fillMaxSize().padding(horizontal = Gutter, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(
                    url = artworkUrl,
                    stale = state.stale,
                    // Bounded by the height as well as the width: a square sized off half a wide
                    // screen is taller than the screen is.
                    modifier = Modifier.weight(1f).widthIn(max = ArtworkMaxWidth).heightIn(max = viewportHeight - 32.dp),
                )
                Column(
                    modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).heightIn(min = viewportHeight - 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Words(state)
                    Controls(state, playhead, onPlay, onStop, onOpenFormat)
                }
            }
        } else {
            CentredColumn {
                Artwork(url = artworkUrl, stale = state.stale, modifier = Modifier.fillMaxWidth().widthIn(max = ArtworkMaxWidth))
                Words(state, modifier = Modifier.padding(top = 32.dp))
                Controls(state, playhead, onPlay, onStop, onOpenFormat)
            }
        }
    }
}

@Composable
private fun Words(state: NowPlayingUiState, modifier: Modifier = Modifier) {
    Column(
        // Announced when it changes, without being focused: off air to warming up to a record is
        // the whole story of pressing play, and it happened in silence for a screen reader.
        modifier = modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            state.title.resolve(),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        state.subtitle?.let {
            // A long credit scrolls past rather than being cut, which is what a now-playing line
            // does on every player a listener has used. A sentence of the app's own wraps instead:
            // scrolled, it showed the middle of an instruction with its first word gone.
            Text(
                it.resolve(),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = if (state.subtitleScrolls) 1 else 2,
                overflow = TextOverflow.Ellipsis,
                modifier = if (state.subtitleScrolls) Modifier.basicMarquee() else Modifier,
            )
        }
        state.album?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun Controls(state: NowPlayingUiState, playhead: Playhead?, onPlay: () -> Unit, onStop: () -> Unit, onOpenFormat: () -> Unit) {
    // Only when the decoder could say how long is left. A bar that appeared with a guessed
    // position would be worse than no bar.
    if (playhead != null) {
        val progress by animateFloatAsState(playhead.fraction, label = "playhead")
        val elapsed = clockOf(playhead.elapsedMs)
        val total = clockOf(playhead.durationMs)
        val position = stringResource(R.string.playhead_position, elapsed, total)
        LinearProgressIndicator(
            progress = { progress },
            // The numbers the bar is drawn from, spoken as well as shown: a bare bar is meaningless
            // to a screen reader, and less than the data it has to a sighted one.
            modifier = Modifier.fillMaxWidth().padding(top = 24.dp).semantics { stateDescription = position },
        )
        Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(elapsed, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(total, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    // The name lives on the button, not on the icon inside it. While the station warms up the
    // icon is swapped for a spinner, and a name that went with the icon left TalkBack announcing
    // an unlabelled button that was still a live stop control — for as long as a warm-up takes,
    // which on an audience-gated station is every time.
    val label = stringResource(if (state.playing) R.string.stop else R.string.play)
    val buffering = stringResource(R.string.buffering)
    FilledIconButton(
        onClick = if (state.playing) onStop else onPlay,
        // Round, which is what a radio's one button is. The default shape is a rounded square.
        shape = CircleShape,
        modifier =
            Modifier.padding(top = 32.dp).size(72.dp).semantics {
                contentDescription = label
                if (state.buffering) stateDescription = buffering
            },
    ) {
        if (state.buffering) {
            CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
        } else {
            Icon(
                painterResource(if (state.playing) R.drawable.ic_stop else R.drawable.ic_play),
                contentDescription = null,
                modifier = Modifier.size(32.dp),
            )
        }
    }

    Text(
        state.footer.resolve(),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 16.dp),
    )

    state.fallbackNote?.let {
        // Information, not a fault: the app handled it and the stream is playing. It was in the
        // error colour, which made a working fallback read as a standing alarm. It leads to the
        // format picker, because that is where the fact it states can be changed.
        Text(
            it.resolve(),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.tertiary,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp).clickable(role = Role.Button, onClick = onOpenFormat).padding(8.dp),
        )
    }
}

@Composable
private fun Artwork(url: String?, stale: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.aspectRatio(1f).clip(RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (url == null) {
            Icon(
                painterResource(R.drawable.ic_radio),
                contentDescription = null,
                modifier = Modifier.size(96.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            AsyncImage(
                model = url,
                contentDescription = null,
                // Dimmed while the reading behind it is stale, so a cover that is no longer what is
                // playing does not look current.
                modifier = Modifier.fillMaxSize().alpha(if (stale) 0.4f else 1f),
            )
        }
    }
}

/** Where a phone stops and a tablet starts, which is Material's own line for a medium window. */
private val WIDE = 600.dp
