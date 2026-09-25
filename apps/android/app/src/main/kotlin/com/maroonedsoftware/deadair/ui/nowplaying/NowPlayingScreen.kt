package com.maroonedsoftware.deadair.ui.nowplaying

import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import coil3.request.ImageRequest
import kotlin.math.roundToInt
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInRoot
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
    modifier: Modifier = Modifier,
    /** The operator's Skip, Shuffle and like. All `null` for anyone the station does not call its operator. */
    operator: OperatorControls = OperatorControls(skip = null, shuffle = null, like = null),
    /** Where the cover leads, when the record is known. */
    onArtwork: (() -> Unit)? = null,
    /** The idle timer, upright only. `null` keeps everything on screen. */
    rest: RestState? = null,
    /** Room kept clear at the foot for something drawn over this screen, the tabs, whether or not it is showing. */
    bottomReserve: Dp = 0.dp,
) {
    CoverColored(artworkUrl) {
        BoxWithConstraints(modifier = modifier.fillMaxSize()) {
            if (sideBySide(maxWidth, maxHeight)) {
                val viewportHeight = maxHeight
                Row(
                    modifier =
                        Modifier.fillMaxSize()
                            .windowInsetsPadding(WindowInsets.statusBars)
                            .windowInsetsPadding(WindowInsets.navigationBars.only(WindowInsetsSides.Bottom))
                            .padding(bottom = bottomReserve)
                            .padding(horizontal = Gutter, vertical = 16.dp),
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
                FullBleed(state, artworkUrl, playhead, onPlay, onStop, operator, onArtwork, rest, bottomReserve)
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
    bottomReserve: Dp,
) {
    val background = MaterialTheme.colorScheme.background

    // Resting, everything but the cover fades: the glow, the fade that carried it into the page, the
    // words, the line and the controls, and the cover moves to the middle of the screen at the size it
    // already was. Never larger: a cover is square, and filling a tall screen with one means cutting
    // most of it off. They come back on the first touch, which does nothing else (see `wakesRest`).
    val resting = rest?.resting == true
    val shown by animateFloatAsState(if (resting) 0f else 1f, animationSpec = tween(if (resting) 900 else 250), label = "chrome")

    // Where the screen's middle and the cover's middle are, measured rather than worked out, so the
    // resting cover lands in the middle however the stack above and below it came out.
    var screenMiddle by remember { mutableFloatStateOf(0f) }
    var screenTop by remember { mutableFloatStateOf(0f) }
    var coverMiddle by remember { mutableFloatStateOf(0f) }

    BoxWithConstraints(
        modifier =
            Modifier.fillMaxSize()
                .background(background)
                .onPlaced {
                    screenTop = it.positionInRoot().y
                    screenMiddle = screenTop + it.size.height / 2f
                }
                .then(if (rest != null) Modifier.wakesRest(rest) else Modifier),
    ) {
        val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
        val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + bottomReserve
        // As wide as the screen allows, and no taller than leaves the words and the controls their
        // room: on a short phone the cover gives way, never the controls.
        val side = minOf(maxWidth, ArtworkMaxWidth * 2, (maxHeight - top - bottom - BelowCover).coerceAtLeast(MinCover))

        // The bleed: the cover's colour, glowing out from behind it. Drawn from a tiny sample of the
        // cover blown up (four pixels a side, so no shape survives, only colour) and centred on the
        // cover at twice its size, so each edge of the sharp cover dissolves into its OWN colour and
        // the glow spreads out from it into the status bar above and the controls below. The first
        // version stretched the whole cover over the whole screen: the blur was weak at that scale,
        // the cover's shapes showed through as grey bands and blotches, and its edges melted into
        // colours from somewhere else in the picture. Blurred as well where the platform can
        // (Android 12 and later); the sample alone is already a soft wash before that.
        if (artworkUrl != null) {
            val context = LocalContext.current
            val sample = remember(artworkUrl) { ImageRequest.Builder(context).data(artworkUrl).size(GLOW_SAMPLE_PX).build() }
            val glow = side * GlowScale
            Box(
                modifier =
                    Modifier.align(Alignment.TopCenter)
                        .offset { IntOffset(0, (coverMiddle - screenTop - glow.toPx() / 2f).roundToInt()) }
                        .wrapContentSize(unbounded = true)
                        .requiredSize(glow)
                        .alpha(shown * BleedStrength),
            ) {
                AsyncImage(
                    model = sample,
                    contentDescription = null,
                    contentScale = ContentScale.FillBounds,
                    filterQuality = FilterQuality.High,
                    modifier = Modifier.fillMaxSize().then(if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Modifier.blur(BleedBlur) else Modifier),
                )
                // Its edge fades into the page all the way round, so the glow has no rim of its own.
                Box(modifier = Modifier.fillMaxSize().background(Brush.radialGradient(0.35f to Color.Transparent, 1f to background)))
            }
        }

        // One stack, centred between the status bar and the tabs' place: the cover, the words, the
        // line and the controls, with set gaps between them, so the room left over is shared above
        // and below the whole rather than opening up inside it.
        Column(
            modifier = Modifier.fillMaxSize().padding(top = top, bottom = bottom),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Its edges dissolve (made transparent, not painted over), so it melts into the glow behind
            // it rather than into a flat band of the background's colour. A tap on the art still
            // reaches it: the fade is drawn, not laid over it.
            Box(
                modifier =
                    Modifier.size(side)
                        // Measured before the resting move below is applied, so it is where the cover
                        // sits in the stack and not where it has drifted to.
                        .onPlaced { coverMiddle = it.positionInRoot().y + it.size.height / 2f }
                        .graphicsLayer {
                            translationY = (1f - shown) * (screenMiddle - coverMiddle)
                            compositingStrategy = CompositingStrategy.Offscreen
                        }.drawWithContent {
                            drawContent()
                            val kept = Color.Black
                            val gone = Color.Black.copy(alpha = 1f - shown)
                            // Both edges: now that the stack is centred the cover's top no longer
                            // meets the status bar, and a hard line there against the glow read as
                            // a picture pasted on rather than one the colour came out of.
                            drawRect(Brush.verticalGradient(0f to gone, 0.12f to kept, 0.55f to kept, 1f to gone), blendMode = BlendMode.DstIn)
                        },
            ) {
                Artwork(url = artworkUrl, stale = state.stale, onOpen = onArtwork, modifier = Modifier.fillMaxSize())
            }
            Column(modifier = Modifier.fillMaxWidth().alpha(shown).padding(horizontal = Gutter)) {
                Spacer(Modifier.height(CoverGap))
                Words(state, centred = true)
                Controls(state, playhead, onPlay, onStop, operator)
            }
        }
    }
}

/** The room between the foot of the cover and the words under it. */
private val CoverGap = 16.dp

/** What the words, the line and the controls take under the cover, at most: two lines of title, the credit, the host. */
private val BelowCover = 300.dp

/** The smallest the cover gets on a short phone before the stack is allowed to crowd. */
private val MinCover = 180.dp

/** How much of the glow shows through: enough to colour the page, not enough to compete with the words. */
private const val BleedStrength = 0.75f

/** Softened on top of the sample, where the platform can. */
private val BleedBlur = 64.dp

/** How big the glow is against the cover it comes out of. */
private const val GlowScale = 1.8f

/** Pixels a side the glow is sampled at: few enough that no shape survives, enough to keep the cover's colours where they are. */
private const val GLOW_SAMPLE_PX = 4

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
