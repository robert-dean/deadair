package com.maroonedsoftware.deadair.ui.nowplaying

import android.app.WallpaperColors
import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.toBitmap
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** What Now playing takes from a cover: the accent its controls wear, and the colours of the mesh behind them. */
data class CoverPalette(
    /** `null` on a cover with no colour worth a button (see [coverAccent]): the controls keep the theme's. */
    val accent: CoverAccent?,
    /** Empty only when the cover gave no colours at all (see [meshColors]). */
    val mesh: List<Int>,
)

/**
 * Now playing, in the cover's colour: the play button and its glow, the line and the heart.
 *
 * Only `primary` and `onPrimary` are replaced, because those are what the accents are drawn in; the
 * page, the words and the tabs keep the theme, so a loud cover recolours the controls without
 * making the screen hard to read. The change is eased over a moment rather than cut, since it
 * happens when a record changes and the eye is on the screen.
 */
@Composable
fun CoverColored(accent: CoverAccent?, content: @Composable () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val primary by animateColorAsState(accent?.let { Color(it.accent) } ?: scheme.primary, tween(ACCENT_FADE_MS), label = "accent")
    val onPrimary by animateColorAsState(accent?.let { Color(it.onAccent) } ?: scheme.onPrimary, tween(ACCENT_FADE_MS), label = "onAccent")
    MaterialTheme(colorScheme = scheme.copy(primary = primary, onPrimary = onPrimary), typography = MaterialTheme.typography, content = content)
}

/**
 * What a cover gives: `null` when there is no cover, and the previous cover's while a new one is
 * read, so the screen goes from one record's colours to the next's rather than through the theme's.
 *
 * Read through the app's own image loader, so it is the same request the cover itself made (the
 * same agent, and usually straight from its cache), at a size that is plenty to find three colours
 * in. The colours are the platform's own reading, `WallpaperColors.fromBitmap`, as the live
 * wallpaper's are: it is already on the phone, and it is what the system would pick. That reading
 * arrived in Android 8.1, so 8.0 keeps the theme and paints no mesh.
 */
@Composable
fun rememberCoverPalette(url: String?, darkPage: Boolean): CoverPalette? {
    val context = LocalContext.current
    val palette by
        produceState<CoverPalette?>(initialValue = null, url, darkPage) {
            if (url == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
                value = null
                return@produceState
            }
            try {
                val request = ImageRequest.Builder(context).data(url).allowHardware(false).size(COLOR_SAMPLE_PX).build()
                // A cover that will not load keeps the colours it has: the screen still shows the
                // last picture, and the next record is a few minutes away.
                val bitmap = SingletonImageLoader.get(context).execute(request).image?.toBitmap() ?: return@produceState
                value =
                    withContext(Dispatchers.Default) {
                        val read = WallpaperColors.fromBitmap(bitmap)
                        val colours = listOfNotNull(read.primaryColor, read.secondaryColor, read.tertiaryColor).map { it.toArgb() }
                        CoverPalette(accent = coverAccent(colours, darkPage), mesh = meshColors(colours, darkPage))
                    }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Keeps what it has, for the same reason as a cover that will not load.
            }
        }
    return palette
}

/** Plenty of pixels to find a cover's colours in, and few enough to read them in a blink. */
private const val COLOR_SAMPLE_PX = 128

private const val ACCENT_FADE_MS = 600
