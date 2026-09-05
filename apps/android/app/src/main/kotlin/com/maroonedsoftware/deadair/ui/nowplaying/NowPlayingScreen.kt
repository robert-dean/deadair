package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.Playhead

/**
 * One screen: what is on air, and a button.
 *
 * There is no queue, no history and no scrubber, because a listener has none of those — the station
 * decides what plays next and there is no going back. Everything on screen is either what is
 * playing or a way to change how it is heard.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NowPlayingScreen(
    state: NowPlayingUiState,
    artworkUrl: String?,
    playhead: Playhead?,
    onPlay: () -> Unit,
    onStop: () -> Unit,
    onSettings: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(state.station, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                actions = {
                    IconButton(onClick = onSettings) {
                        Icon(painterResource(R.drawable.ic_settings), contentDescription = "Settings")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Artwork(artworkUrl, stale = state.stale)

            Column(
                modifier = Modifier.fillMaxWidth().padding(top = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    state.title,
                    style = MaterialTheme.typography.headlineSmall,
                    textAlign = TextAlign.Center,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                state.subtitle?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
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

            // Only when the decoder could say how long is left. A bar that appeared with a guessed
            // position would be worse than no bar.
            if (playhead != null) {
                val progress by animateFloatAsState(playhead.fraction, label = "playhead")
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                )
            }

            FilledIconButton(
                onClick = if (state.playing) onStop else onPlay,
                modifier = Modifier.padding(top = 32.dp).size(72.dp),
            ) {
                if (state.buffering) {
                    CircularProgressIndicator(modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                } else {
                    Icon(
                        painterResource(if (state.playing) R.drawable.ic_stop else R.drawable.ic_play),
                        contentDescription = if (state.playing) "Stop" else "Play",
                        modifier = Modifier.size(32.dp),
                    )
                }
            }

            Text(
                state.footer,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp),
            )

            if (state.fellBackToMp3) {
                Text(
                    "This station does not publish ${state.format.label}. Playing MP3.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun Artwork(url: String?, stale: Boolean) {
    Box(
        modifier = Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp)),
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
