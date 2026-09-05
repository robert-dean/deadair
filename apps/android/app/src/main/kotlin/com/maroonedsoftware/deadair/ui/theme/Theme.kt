package com.maroonedsoftware.deadair.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// The station's own palette, for the devices that have no wallpaper colours to offer. Carbon and
// a phosphor green, which is what the console uses for the same reason: it is a broadcast desk.
private val Phosphor = Color(0xFF3DDC91)
private val Carbon = Color(0xFF101214)
private val CarbonRaised = Color(0xFF191C1F)

private val DarkScheme =
    darkColorScheme(
        primary = Phosphor,
        onPrimary = Carbon,
        background = Carbon,
        surface = Carbon,
        surfaceVariant = CarbonRaised,
    )

private val LightScheme = lightColorScheme(primary = Color(0xFF006C4C))

/**
 * The app's theme.
 *
 * Dynamic colour where the platform offers it (31+), because a listener's own wallpaper palette is
 * a better answer than anything chosen here, with the station's palette as the fallback.
 */
@Composable
fun DeadairTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val context = LocalContext.current
    val scheme =
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
            darkTheme -> DarkScheme
            else -> LightScheme
        }

    MaterialTheme(colorScheme = scheme, content = content)
}
