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

// The station's own palette: carbon and a phosphor green, which is what the console uses for the
// same reason — it is a broadcast desk. Both schemes are filled in completely rather than seeded
// with one colour, because a scheme that names only `primary` leaves every container role at
// Material's baseline purple, and the first version of the light theme was a green button in a
// purple app.

private val DarkScheme =
    darkColorScheme(
        primary = Color(0xFF3DDC91),
        onPrimary = Color(0xFF003824),
        primaryContainer = Color(0xFF005236),
        onPrimaryContainer = Color(0xFF5FF9AC),
        secondary = Color(0xFFB3CCBE),
        onSecondary = Color(0xFF1F352A),
        secondaryContainer = Color(0xFF354B40),
        onSecondaryContainer = Color(0xFFCFE9DA),
        tertiary = Color(0xFFA4CDDD),
        onTertiary = Color(0xFF063542),
        tertiaryContainer = Color(0xFF234C5A),
        onTertiaryContainer = Color(0xFFC0E9FA),
        error = Color(0xFFFFB4AB),
        onError = Color(0xFF690005),
        errorContainer = Color(0xFF93000A),
        onErrorContainer = Color(0xFFFFDAD6),
        background = Color(0xFF101214),
        onBackground = Color(0xFFE1E3E1),
        surface = Color(0xFF101214),
        onSurface = Color(0xFFE1E3E1),
        surfaceVariant = Color(0xFF3F4943),
        onSurfaceVariant = Color(0xFFBFC9C1),
        outline = Color(0xFF89938B),
        outlineVariant = Color(0xFF3F4943),
        surfaceContainerLowest = Color(0xFF0B0D0F),
        surfaceContainerLow = Color(0xFF191C1F),
        surfaceContainer = Color(0xFF1D2023),
        surfaceContainerHigh = Color(0xFF272A2D),
        surfaceContainerHighest = Color(0xFF323538),
        inverseSurface = Color(0xFFE1E3E1),
        inverseOnSurface = Color(0xFF2E3133),
        inversePrimary = Color(0xFF006C4C),
    )

private val LightScheme =
    lightColorScheme(
        primary = Color(0xFF006C4C),
        onPrimary = Color(0xFFFFFFFF),
        primaryContainer = Color(0xFF5FF9AC),
        onPrimaryContainer = Color(0xFF002114),
        secondary = Color(0xFF4D6357),
        onSecondary = Color(0xFFFFFFFF),
        secondaryContainer = Color(0xFFCFE9DA),
        onSecondaryContainer = Color(0xFF0A1F16),
        tertiary = Color(0xFF3D6472),
        onTertiary = Color(0xFFFFFFFF),
        tertiaryContainer = Color(0xFFC0E9FA),
        onTertiaryContainer = Color(0xFF001F28),
        error = Color(0xFFBA1A1A),
        onError = Color(0xFFFFFFFF),
        errorContainer = Color(0xFFFFDAD6),
        onErrorContainer = Color(0xFF410002),
        background = Color(0xFFFBFDF8),
        onBackground = Color(0xFF191C1A),
        surface = Color(0xFFFBFDF8),
        onSurface = Color(0xFF191C1A),
        surfaceVariant = Color(0xFFDBE5DD),
        onSurfaceVariant = Color(0xFF3F4943),
        outline = Color(0xFF707973),
        outlineVariant = Color(0xFFBFC9C1),
        surfaceContainerLowest = Color(0xFFFFFFFF),
        surfaceContainerLow = Color(0xFFF5F7F3),
        surfaceContainer = Color(0xFFEFF1ED),
        surfaceContainerHigh = Color(0xFFE9EBE7),
        surfaceContainerHighest = Color(0xFFE3E5E1),
        inverseSurface = Color(0xFF2E3133),
        inverseOnSurface = Color(0xFFEFF1ED),
        inversePrimary = Color(0xFF3DDC91),
    )

/** Whether this device can offer colours from its wallpaper at all. Below this the station's palette is the only one. */
val supportsDynamicColour: Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

/**
 * The app's theme.
 *
 * Wallpaper colours where the platform offers them and the listener has not said otherwise,
 * because a listener's own palette is a better default than anything chosen here — and the
 * station's own palette behind a switch, because before there was a switch that palette was
 * unreachable on every phone made since 2021, which is every phone.
 */
@Composable
fun DeadairTheme(
    dynamicColour: Boolean = true,
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val scheme =
        when {
            dynamicColour && supportsDynamicColour -> if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
            darkTheme -> DarkScheme
            else -> LightScheme
        }

    MaterialTheme(colorScheme = scheme, typography = AppTypography, content = content)
}
