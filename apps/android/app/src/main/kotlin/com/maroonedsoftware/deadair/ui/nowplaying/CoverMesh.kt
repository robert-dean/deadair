package com.maroonedsoftware.deadair.ui.nowplaying

import android.provider.Settings
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlin.math.cos
import kotlin.math.sin

/**
 * The cover's colours as a mesh behind Now playing: four large soft blobs, each drifting on its own
 * slow loop, so the page carries the record's mood without a stretched copy of its picture.
 *
 * The blobs move only while the caller says so ([moving]: Now playing asks while the station is
 * airing), and not at all when the phone's animations are switched off, because a screen that
 * drifts on its own is a thing somebody may have asked not to see. Standing still, it is the same mesh at rest. Time is advanced by frame
 * and read only while drawing, so the drift redraws the canvas without recomposing anything. A new
 * record's colours are eased in rather than cut, since the change happens while the eye is on it.
 *
 * Decoration only, so it says nothing to a screen reader.
 */
@Composable
fun CoverMesh(colors: List<Int>, moving: Boolean, modifier: Modifier = Modifier) {
    if (colors.isEmpty()) return
    val context = LocalContext.current
    val animationsOn = remember(context) { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f }

    val painted = BLOBS.indices.map { index -> animateColorAsState(Color(colors[index % colors.size]), tween(COLOUR_FADE_MS), label = "mesh$index") }

    var seconds by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(moving && animationsOn) {
        if (!(moving && animationsOn)) return@LaunchedEffect
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                if (last != 0L) seconds += (now - last) / 1_000_000_000f
                last = now
            }
        }
    }

    Canvas(modifier = modifier.clearAndSetSemantics {}) {
        BLOBS.forEachIndexed { index, blob ->
            val colour = painted[index].value
            val phase = seconds * blob.speed + blob.offset
            val centre = Offset(size.width * (blob.x + blob.driftX * sin(phase)), size.height * (blob.y + blob.driftY * cos(phase * 0.8f)))
            val radius = size.width * blob.radius
            drawCircle(
                brush = Brush.radialGradient(0f to colour.copy(alpha = 0.9f), 0.5f to colour.copy(alpha = 0.45f), 1f to Color.Transparent, center = centre, radius = radius),
                radius = radius,
                center = centre,
            )
        }
    }
}

/**
 * Where a blob rests (as a share of the screen), how far it drifts either way, how big it is (as a
 * share of the width), and how fast and from where in its loop it moves. Laid out corner to corner
 * so the four cover the page between them, and at speeds that never line up, so the drift does not
 * visibly repeat.
 */
private class Blob(val x: Float, val y: Float, val driftX: Float, val driftY: Float, val radius: Float, val speed: Float, val offset: Float)

private val BLOBS =
    listOf(
        Blob(x = 0.2f, y = 0.16f, driftX = 0.22f, driftY = 0.09f, radius = 0.85f, speed = 0.38f, offset = 0f),
        Blob(x = 0.85f, y = 0.38f, driftX = 0.19f, driftY = 0.11f, radius = 0.9f, speed = 0.31f, offset = 1.7f),
        Blob(x = 0.15f, y = 0.66f, driftX = 0.18f, driftY = 0.1f, radius = 0.9f, speed = 0.23f, offset = 3.1f),
        Blob(x = 0.8f, y = 0.9f, driftX = 0.2f, driftY = 0.08f, radius = 0.85f, speed = 0.34f, offset = 4.4f),
    )

private const val COLOUR_FADE_MS = 1_200
