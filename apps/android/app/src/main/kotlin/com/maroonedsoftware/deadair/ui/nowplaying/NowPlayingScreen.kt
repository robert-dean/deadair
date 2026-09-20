package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.activity.compose.LocalActivity
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import coil3.compose.AsyncImage
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.Playhead
import com.maroonedsoftware.deadair.nowplaying.clockOf
import com.maroonedsoftware.deadair.ui.text.resolve
import com.maroonedsoftware.deadair.ui.theme.ArtworkMaxWidth
import com.maroonedsoftware.deadair.ui.theme.Gutter

/**
 * What is on air, and the controls under it.
 *
 * There is no queue and no scrubber, because a listener has neither — the station decides what
 * plays next and there is no going back. This is the present tense and nothing else: the cover, the
 * words, where the record has got to, and two round controls of the same size, centred. Stop, which
 * stops THIS PHONE, and Skip, for the operator, which ends one record. Everything that can take the
 * station off air is on the desk, so nothing here can be mistaken for it, and nothing appears or
 * disappears above the pair, so it never moves under a thumb.
 *
 * It carries no `Scaffold` and no app bar. Upright, the cover runs full-bleed to the top of the
 * screen under the status bar, and the words sit over its foot where a scrim has taken it to the
 * background color.
 *
 * ## Two layouts, one screen
 *
 * Sideways, or on anything wide enough to be a tablet, the cover sits beside the words instead: a
 * full-width cover in landscape is taller than the screen, and the first version of this measured
 * the play button out of existence there. That side scrolls when its content outgrows it, which it
 * does at the largest accessibility text size.
 */
@Composable
fun NowPlayingScreen(
    state: NowPlayingUiState,
    artworkUrl: String?,
    playhead: Playhead?,
    onPlay: () -> Unit,
    onStop: () -> Unit,
    /** The operator's Skip, and whether it has anything to skip. `null` for anyone the station does not call its operator. */
    skip: SkipControl? = null,
    /** Where the cover leads, when the record is known. */
    onArtwork: (() -> Unit)? = null,
    /** The idle timer, upright only. `null` keeps everything on screen. */
    rest: RestState? = null,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        if (sideBySide(maxWidth, maxHeight)) {
            val viewportHeight = maxHeight
            Row(
                modifier = Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars).padding(horizontal = Gutter, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(
                    url = artworkUrl,
                    stale = state.stale,
                    onOpen = onArtwork,
                    // Bounded by the height as well as the width: a square sized off half a wide
                    // screen is taller than the screen is.
                    modifier = Modifier.weight(1f).widthIn(max = ArtworkMaxWidth).heightIn(max = viewportHeight - 32.dp).aspectRatio(1f).clip(RoundedCornerShape(12.dp)),
                )
                Column(
                    modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).heightIn(min = viewportHeight - 32.dp),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Words(state)
                    Controls(state, playhead, onPlay, onStop, skip)
                }
            }
        } else {
            FullBleed(state, artworkUrl, playhead, onPlay, onStop, skip, onArtwork, rest)
        }
    }
}

/** The operator's Skip on Now playing: the same command as the desk's, reachable from the screen already open. */
data class SkipControl(val enabled: Boolean, val onSkip: () -> Unit)

@Composable
private fun FullBleed(
    state: NowPlayingUiState,
    artworkUrl: String?,
    playhead: Playhead?,
    onPlay: () -> Unit,
    onStop: () -> Unit,
    skip: SkipControl?,
    onArtwork: (() -> Unit)?,
    rest: RestState?,
) {
    LightStatusBarIcons()
    val background = MaterialTheme.colorScheme.background

    // Resting, everything but the cover fades: the scrim that carried it into the background, the
    // words, the bar and the controls, and the cover moves to the middle of the screen at the size it
    // already was. Never larger: a cover is square, and filling a tall screen with one means cutting
    // most of it off. They come back on the first touch, which does nothing else (see `wakesRest`).
    val resting = rest?.resting == true
    val shown by animateFloatAsState(if (resting) 0f else 1f, animationSpec = tween(if (resting) 900 else 250), label = "chrome")
    val coverBias by animateFloatAsState(if (resting) 0f else -1f, animationSpec = tween(if (resting) 900 else 250), label = "cover")

    Box(modifier = Modifier.fillMaxSize().background(background).then(if (rest != null) Modifier.wakesRest(rest) else Modifier)) {
        // The cover and nothing over it but the scrim: the only thing on the art is the art.
        val cover = Modifier.fillMaxWidth().widthIn(max = ArtworkMaxWidth * 2).aspectRatio(1f).align(BiasAlignment(0f, coverBias))
        Artwork(url = artworkUrl, stale = state.stale, onOpen = onArtwork, modifier = cover)
        // Its foot melts into the background, so it ends without an edge and the words under it read
        // on plain ground. Measured on the cover rather than the screen, so it is the same fade on
        // every height of phone. Drawn with no pointer input, so a tap on the art still reaches it.
        Box(modifier = cover.alpha(shown).background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to background)))
        // Dark at the top so the status bar reads over any cover, resting or not.
        Box(modifier = Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.45f), 0.15f to Color.Transparent)))
        Column(modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().alpha(shown).padding(start = Gutter, end = Gutter, bottom = 24.dp)) {
            Words(state)
            Controls(state, playhead, onPlay, onStop, skip)
        }
    }
}

/**
 * The status bar's icons are light while the cover is under them, whatever the theme: the top of
 * the scrim is dark on every cover, and dark icons on it were unreadable in the light scheme. Put
 * back to the theme's own choice on the way out, so the other tabs keep theirs.
 */
@Composable
private fun LightStatusBarIcons() {
    val window = LocalActivity.current?.window ?: return
    DisposableEffect(window) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        val before = controller.isAppearanceLightStatusBars
        controller.isAppearanceLightStatusBars = false
        onDispose { controller.isAppearanceLightStatusBars = before }
    }
}

@Composable
private fun Words(state: NowPlayingUiState, modifier: Modifier = Modifier) {
    Column(
        // Announced when it changes, without being focused: off air to warming up to a record is
        // the whole story of pressing play, and it happened in silence for a screen reader.
        modifier = modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        // The programme first, the way a station's own app leads with the show and its host. One
        // line: it is a label over the record rather than something to read in full.
        state.header?.let {
            Text(
                it.resolve(),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(state.title.resolve(), style = MaterialTheme.typography.headlineLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
        state.subtitle?.let {
            // A long credit scrolls past rather than being cut, which is what a now-playing line
            // does on every player a listener has used. A sentence of the app's own wraps instead:
            // scrolled, it showed the middle of an instruction with its first word gone.
            Text(
                it.resolve(),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (state.subtitleScrolls) 1 else 2,
                overflow = TextOverflow.Ellipsis,
                modifier = if (state.subtitleScrolls) Modifier.basicMarquee() else Modifier,
            )
        }
        state.album?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun Controls(state: NowPlayingUiState, playhead: Playhead?, onPlay: () -> Unit, onStop: () -> Unit, skip: SkipControl?) {
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
            modifier = Modifier.fillMaxWidth().padding(top = 20.dp).semantics { stateDescription = position },
        )
        Row(modifier = Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(elapsed, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(total, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    // Equal in size and centred, so neither reads as the lesser control. A listener has one.
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PlayStopButton(playing = state.playing, buffering = state.buffering, onPlay = onPlay, onStop = onStop)
        skip?.let { SkipButton(it) }
    }
}

@Composable
private fun SkipButton(skip: SkipControl) {
    val label = stringResource(R.string.skip)
    OutlinedIconButton(
        onClick = skip.onSkip,
        enabled = skip.enabled,
        shape = CircleShape,
        border = BorderStroke(1.dp, if (skip.enabled) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.size(72.dp).semantics { contentDescription = label },
    ) {
        Icon(painterResource(R.drawable.ic_skip_next), contentDescription = null, modifier = Modifier.size(30.dp))
    }
}

@Composable
private fun Artwork(url: String?, stale: Boolean, onOpen: (() -> Unit)?, modifier: Modifier = Modifier) {
    val opens = stringResource(R.string.open_record)
    Box(
        modifier =
            modifier.background(MaterialTheme.colorScheme.surfaceContainer).then(
                if (onOpen != null) Modifier.clickable(role = Role.Button, onClickLabel = opens, onClick = onOpen) else Modifier,
            ),
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
                contentScale = ContentScale.Crop,
                alignment = Alignment.TopCenter,
                // Dimmed while the reading behind it is stale, so a cover that is no longer what is
                // playing does not look current.
                modifier = Modifier.fillMaxSize().alpha(if (stale) 0.4f else 1f),
            )
        }
    }
}

/** Where a phone stops and a tablet starts, which is Material's own line for a medium window. */
private val WIDE = 600.dp

/** Sideways, or a tablet: the cover beside the words rather than behind them. Only upright can rest. */
fun sideBySide(width: Dp, height: Dp): Boolean = width > height || width >= WIDE
