package com.maroonedsoftware.deadair.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.ui.nowplaying.NowPlayingUiState
import com.maroonedsoftware.deadair.ui.nowplaying.PlayStopButton
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * What is on air, and the one button, over every tab but Now playing.
 *
 * Leaving Now playing used to leave the listener with no way to stop the station short of the
 * notification shade, which is what every other radio app's player bar exists to answer. It is not
 * drawn on Now playing itself, whose own button is 72dp and a thumb away: two live stop controls on
 * one screen is one too many.
 *
 * Every word comes from the same [NowPlayingUiState] the full screen reads, so the bar and the
 * screen cannot disagree about what is on. The subtitle does not scroll here: a bar is glanced at,
 * and a marquee in it would pull the eye for as long as the tab is open. And it is drawn only when
 * it is the station's words, because the app's own second lines are sentences that a one-line bar
 * cuts off before the part that says what to do.
 *
 * Not on the pushed screens (a record, an album, a plan, the scripts). Each owns its own frame, is
 * an errand somebody goes and does and comes back from, and the notification is the control there.
 */
@Composable
fun MiniPlayer(state: NowPlayingUiState, artworkUrl: String?, onOpen: () -> Unit, onPlay: () -> Unit, onStop: () -> Unit) {
    val opens = stringResource(R.string.open_now_playing)
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = Gutter, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // The artwork and the words are one target, which opens Now playing; the button beside
            // them is its own. A tap meant for the words must never stop the station.
            Row(
                modifier = Modifier.weight(1f).clickable(role = Role.Button, onClickLabel = opens, onClick = onOpen).padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Thumbnail(artworkUrl, stale = state.stale)
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        state.title.resolve(),
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    // Only the station's own words: a credit, or a break's label. The app's own
                    // second lines are sentences ("Quiet until someone tunes in, press play..."), and
                    // cut to one line in a bar they lose the half that says what to do.
                    state.subtitle?.takeIf { state.subtitleScrolls }?.let {
                        Text(
                            it.resolve(),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            PlayStopButton(playing = state.playing, buffering = state.buffering, onPlay = onPlay, onStop = onStop, size = 44.dp, iconSize = 24.dp)
        }
    }
}

@Composable
private fun Thumbnail(url: String?, stale: Boolean) {
    Box(modifier = Modifier.size(48.dp).clip(RoundedCornerShape(4.dp)), contentAlignment = Alignment.Center) {
        if (url == null) {
            Icon(painterResource(R.drawable.ic_radio), contentDescription = null, modifier = Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            // Dimmed while the reading behind it is stale, as the full-size cover is.
            AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxSize().alpha(if (stale) 0.4f else 1f))
        }
    }
}
