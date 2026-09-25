package com.maroonedsoftware.deadair.ui.nowplaying

import android.os.Build
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.height
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.LocalContentColor
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
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
 * It carries no `Scaffold` and no app bar. Upright, the cover runs the full width from just under
 * the status bar, its foot bleeds into the background, and the words start in that fade rather
 * than after a band of empty ground.
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
    /** The operator's Skip, Shuffle and like. All `null` for anyone the station does not call its operator. */
    operator: OperatorControls = OperatorControls(skip = null, shuffle = null, like = null),
    /** Where the cover leads, when the record is known. */
    onArtwork: (() -> Unit)? = null,
    /** The idle timer, upright only. `null` keeps everything on screen. */
    rest: RestState? = null,
) {
    CoverColored(artworkUrl) {
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
                        Words(state, centred = false)
                        Controls(state, playhead, onPlay, onStop, operator)
                    }
                }
            } else {
                FullBleed(state, artworkUrl, playhead, onPlay, onStop, operator, onArtwork, rest)
            }
        }
    }
}

/** The operator's Skip on Now playing: the same command as the desk's, reachable from the screen already open. */
data class SkipControl(val enabled: Boolean, val onSkip: () -> Unit)

/** The operator's Shuffle on Now playing: the same reshuffle of what is coming up as Up next's. */
data class ShuffleControl(val enabled: Boolean, val onShuffle: () -> Unit)

/** The operator's like on Now playing. [liked] is `null` until the record's rating has been read. */
data class LikeControl(val liked: Boolean?, val enabled: Boolean, val onToggle: () -> Unit)

@Composable
private fun FullBleed(
    state: NowPlayingUiState,
    artworkUrl: String?,
    playhead: Playhead?,
    onPlay: () -> Unit,
    onStop: () -> Unit,
    operator: OperatorControls,
    onArtwork: (() -> Unit)?,
    rest: RestState?,
) {
    val background = MaterialTheme.colorScheme.background

    // Resting, everything but the cover fades: the glow, the fade that carried it into the page, the
    // words, the line and the controls, and the cover moves to the middle of the screen at the size it
    // already was. Never larger: a cover is square, and filling a tall screen with one means cutting
    // most of it off. They come back on the first touch, which does nothing else (see `wakesRest`).
    val resting = rest?.resting == true
    val shown by animateFloatAsState(if (resting) 0f else 1f, animationSpec = tween(if (resting) 900 else 250), label = "chrome")

    BoxWithConstraints(modifier = Modifier.fillMaxSize().background(background).then(if (rest != null) Modifier.wakesRest(rest) else Modifier)) {
        val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
        val side = minOf(maxWidth, ArtworkMaxWidth * 2)
        // How far the cover travels to sit in the middle of the screen while resting.
        val toMiddle = ((maxHeight - side) / 2 - top).coerceAtLeast(0.dp)

        // The bleed: the cover again, blurred past recognition, behind the sharp one and reaching
        // further down, so its colour spills into the page under the words instead of stopping at
        // the cover's edge. Android 12 and later only, because `blur` is a no-op before that and a
        // second sharp copy would be a ghost rather than a glow.
        if (artworkUrl != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Box(modifier = Modifier.padding(top = top).fillMaxWidth().height(side * BleedReach).alpha(shown * BleedStrength)) {
                AsyncImage(model = artworkUrl, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().blur(BleedBlur))
                // Its own foot fades into the page, so the glow has no edge either.
                Box(modifier = Modifier.fillMaxSize().background(Brush.verticalGradient(0.4f to Color.Transparent, 1f to background)))
            }
        }

        Column(modifier = Modifier.fillMaxSize().padding(top = top)) {
            // Below the status bar rather than under it, so the bar reads on the theme's own ground
            // over every cover. Its foot dissolves (made transparent, not painted over), so it melts
            // into the glow behind it rather than into a flat band of the background's colour. A tap
            // on the art still reaches it: the fade is drawn, not laid over it.
            Box(
                modifier =
                    Modifier.align(Alignment.CenterHorizontally)
                        .size(side)
                        .graphicsLayer {
                            translationY = (1f - shown) * toMiddle.toPx()
                            compositingStrategy = CompositingStrategy.Offscreen
                        }.drawWithContent {
                            drawContent()
                            val kept = Color.Black
                            val gone = Color.Black.copy(alpha = 1f - shown)
                            drawRect(Brush.verticalGradient(0.55f to kept, 1f to gone), blendMode = BlendMode.DstIn)
                        },
            ) {
                Artwork(url = artworkUrl, stale = state.stale, onOpen = onArtwork, modifier = Modifier.fillMaxSize())
            }
            // The controls sit at the foot, under a thumb, and the words are centred in what is left
            // between them and the cover, with at least a gap's room above so a short phone never
            // runs them into the art.
            Column(modifier = Modifier.fillMaxWidth().weight(1f).alpha(shown).padding(horizontal = Gutter)) {
                Spacer(Modifier.height(CoverGap))
                Spacer(Modifier.weight(1f))
                Words(state, centred = true)
                Spacer(Modifier.weight(1f))
                Controls(state, playhead, onPlay, onStop, operator)
                Spacer(Modifier.height(ControlsFoot))
            }
        }
    }
}

/** The least room between the foot of the cover and the words under it. */
private val CoverGap = 16.dp

/** The room under the controls, above the tabs. */
private val ControlsFoot = 24.dp

/** How far down the glow reaches, as a share of the cover's own height. */
private const val BleedReach = 1.45f

/** How much of the glow shows through: enough to colour the page, not enough to compete with the words. */
private const val BleedStrength = 0.6f

/** Blurred until no shape is left in it, only colour. */
private val BleedBlur = 72.dp

@Composable
private fun Words(state: NowPlayingUiState, centred: Boolean, modifier: Modifier = Modifier) {
    val align = if (centred) TextAlign.Center else TextAlign.Start
    Column(
        // Announced when it changes, without being focused: off air to warming up to a record is
        // the whole story of pressing play, and it happened in silence for a screen reader.
        modifier = modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        horizontalAlignment = if (centred) Alignment.CenterHorizontally else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(state.title.resolve(), style = MaterialTheme.typography.headlineLarge, textAlign = align, maxLines = 2, overflow = TextOverflow.Ellipsis)
        state.subtitle?.let {
            // A long credit scrolls past rather than being cut, which is what a now-playing line
            // does on every player a listener has used. A sentence of the app's own wraps instead:
            // scrolled, it showed the middle of an instruction with its first word gone.
            Text(
                it.resolve(),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = align,
                maxLines = if (state.subtitleScrolls) 1 else 2,
                overflow = TextOverflow.Ellipsis,
                modifier = if (state.subtitleScrolls) Modifier.basicMarquee() else Modifier,
            )
        }
        // Who is presenting, quieter than the credit and under it: the record is the news, the host
        // is who brought it.
        state.hostLine?.let {
            Text(
                it.resolve(),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = align,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        // Beside the cover there is room for the album; under it, the title and the credit are the
        // whole of it, and the album is one tap away on the record's page.
        if (!centred) {
            state.album?.let {
                Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** The operator's three controls beside the play button. Each `null` for anyone the station does not call its operator. */
data class OperatorControls(val skip: SkipControl?, val shuffle: ShuffleControl?, val like: LikeControl?) {
    val any: Boolean get() = skip != null || shuffle != null || like != null
}

@Composable
private fun Controls(state: NowPlayingUiState, playhead: Playhead?, onPlay: () -> Unit, onStop: () -> Unit, operator: OperatorControls) {
    // Only when the decoder could say how long is left. A line that appeared with a guessed
    // position would be worse than no line.
    if (playhead != null) PlayheadLine(playhead, modifier = Modifier.padding(top = 20.dp))

    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 28.dp),
        horizontalArrangement = if (operator.any) Arrangement.SpaceBetween else Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (operator.any) {
            // Five places, the play button in the middle one, so it is centred whichever of the
            // others the station grants. The second is where every other player keeps "previous",
            // and stays empty: a station has no going back, and a control there that did something
            // else would be pressed for the thing it is not.
            Slot { operator.shuffle?.let { SmallControl(R.drawable.ic_shuffle, stringResource(R.string.shuffle), it.enabled, it.onShuffle) } }
            Slot {}
            PlayStopButton(playing = state.playing, buffering = state.buffering, onPlay = onPlay, onStop = onStop, glow = true)
            Slot { operator.skip?.let { SmallControl(R.drawable.ic_skip_next, stringResource(R.string.skip), it.enabled, it.onSkip) } }
            Slot { operator.like?.let { Heart(it) } }
        } else {
            // A listener has one control, and it is the whole row.
            PlayStopButton(playing = state.playing, buffering = state.buffering, onPlay = onPlay, onStop = onStop, glow = true)
        }
    }
}

/**
 * Where the record has got to: a hairline with a dot on it rather than a bar, because nothing here
 * can be dragged and a slider's thick track promises that it can. Spoken as the numbers it is drawn
 * from, since a bare line is meaningless to a screen reader.
 */
@Composable
private fun PlayheadLine(playhead: Playhead, modifier: Modifier = Modifier) {
    val progress by animateFloatAsState(playhead.fraction, label = "playhead")
    val position = stringResource(R.string.playhead_position, clockOf(playhead.elapsedMs), clockOf(playhead.durationMs))
    val track = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.18f)
    val played = MaterialTheme.colorScheme.primary
    Canvas(modifier = modifier.fillMaxWidth().height(12.dp).semantics { stateDescription = position }) {
        val y = size.height / 2
        val x = size.width * progress.coerceIn(0f, 1f)
        val stroke = 2.dp.toPx()
        drawLine(track, Offset(0f, y), Offset(size.width, y), strokeWidth = stroke, cap = StrokeCap.Round)
        drawLine(played, Offset(0f, y), Offset(x, y), strokeWidth = stroke, cap = StrokeCap.Round)
        drawCircle(played, radius = 5.dp.toPx(), center = Offset(x, y))
    }
}

/** A place in the controls row, the same width whether or not anything is in it. */
@Composable
private fun Slot(content: @Composable () -> Unit) {
    Box(modifier = Modifier.size(48.dp), contentAlignment = Alignment.Center) { content() }
}

@Composable
private fun SmallControl(@DrawableRes icon: Int, label: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(48.dp).semantics { contentDescription = label }) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(28.dp))
    }
}

/**
 * The operator's like, as a heart: filled once the station holds the record as liked. Until the
 * record's rating has been read it is drawn empty and pressing it likes the record, which is what
 * it would have done anyway (see [toggledLike]).
 */
@Composable
private fun Heart(like: LikeControl) {
    val liked = like.liked == true
    val label = stringResource(if (liked) R.string.unlike else R.string.like)
    IconToggleButton(
        checked = liked,
        onCheckedChange = { like.onToggle() },
        enabled = like.enabled,
        modifier = Modifier.size(48.dp).semantics { contentDescription = label },
    ) {
        Icon(
            painterResource(if (liked) R.drawable.ic_favorite else R.drawable.ic_favorite_border),
            contentDescription = null,
            tint = if (liked) MaterialTheme.colorScheme.primary else LocalContentColor.current,
            modifier = Modifier.size(26.dp),
        )
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
