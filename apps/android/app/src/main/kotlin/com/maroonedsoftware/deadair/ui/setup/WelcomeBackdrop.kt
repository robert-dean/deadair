package com.maroonedsoftware.deadair.ui.setup

import androidx.compose.foundation.Canvas
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.semantics.clearAndSetSemantics

/**
 * The shape the welcome and sign-in screens are drawn on: one organic blob, running off the top
 * and right edges and bulging down and to the left, where the headline sits.
 *
 * Coloured from the ACTIVE scheme, primary into tertiary, so wallpaper colours tint it like
 * everything else. Its left side dips past the edge between roughly 55% and 80% of the height,
 * which is where text drawn over it in `onPrimary` has to land; move the curve and check the
 * headline is still on it.
 *
 * Decoration only, so it says nothing to a screen reader.
 */
@Composable
fun WelcomeBackdrop(modifier: Modifier = Modifier) {
    val colors = MaterialTheme.colorScheme
    val brush = listOf(colors.tertiary, colors.primary)
    Canvas(modifier.clearAndSetSemantics {}) {
        val w = size.width
        val h = size.height
        val blob =
            Path().apply {
                moveTo(0.28f * w, 0f)
                lineTo(w, 0f)
                lineTo(w, 0.70f * h)
                cubicTo(0.92f * w, 1.0f * h, 0.40f * w, 1.02f * h, 0.12f * w, 0.90f * h)
                cubicTo(-0.08f * w, 0.82f * h, -0.08f * w, 0.52f * h, 0.10f * w, 0.42f * h)
                cubicTo(0.24f * w, 0.33f * h, 0.08f * w, 0.12f * h, 0.28f * w, 0f)
                close()
            }
        drawPath(blob, Brush.linearGradient(brush, start = Offset(w, 0f), end = Offset(0f, h)))
    }
}
