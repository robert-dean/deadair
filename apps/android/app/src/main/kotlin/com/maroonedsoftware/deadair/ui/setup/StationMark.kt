package com.maroonedsoftware.deadair.ui.setup

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.colorResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.maroonedsoftware.deadair.R

/**
 * How wide the splash screen draws the mark's disc. Measured rather than taken from a spec: 192dp
 * on both the emulator (504px at 2.625) and a Pixel 8 Pro (430px at 2.25).
 */
val SplashMarkSize = 192.dp

/**
 * The station's mark as the launcher and the splash screen draw it: the skull on its green disc.
 *
 * Built from the same two layers as the adaptive icon rather than from a flattened copy, so the
 * three can never drift apart. An adaptive icon's foreground is drawn at 108 units and shown
 * through a 72-unit window, so the drawing here is half as wide again as the disc and the circle
 * clips it, which is exactly what the launcher's mask does.
 *
 * The welcome screen draws it at [SplashMarkSize], centred on the whole window, so the splash hands
 * over to a screen with the mark in the same place and nothing jumps.
 */
@Composable
fun StationMark(modifier: Modifier = Modifier, size: Dp = SplashMarkSize) {
    Box(
        modifier = modifier.size(size).clip(CircleShape).background(colorResource(R.color.ic_launcher_background)),
        contentAlignment = Alignment.Center,
    ) {
        Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.requiredSize(size * 1.5f))
    }
}
