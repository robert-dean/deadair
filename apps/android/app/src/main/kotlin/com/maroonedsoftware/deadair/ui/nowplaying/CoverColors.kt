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
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.toBitmap
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Now playing, in the cover's colour: the play button and its glow, the line and the heart.
 *
 * Only `primary` and `onPrimary` are replaced, because those are what the accents are drawn in; the
 * page, the words and the tabs keep the theme, so a loud cover recolours the controls without
 * making the screen hard to read. The change is eased over a moment rather than cut, since it
 * happens when a record changes and the eye is on the screen.
 */
@Composable
fun CoverColored(artworkUrl: String?, content: @Composable () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    val accent = rememberCoverAccent(artworkUrl, darkPage = scheme.background.luminance() < 0.5f)
    val primary by animateColorAsState(accent?.let { Color(it.accent) } ?: scheme.primary, tween(ACCENT_FADE_MS), label = "accent")
    val onPrimary by animateColorAsState(accent?.let { Color(it.onAccent) } ?: scheme.onPrimary, tween(ACCENT_FADE_MS), label = "onAccent")
    MaterialTheme(colorScheme = scheme.copy(primary = primary, onPrimary = onPrimary), typography = MaterialTheme.typography, content = content)
}

/**
 * The accent a cover gives: `null` when there is no cover and on a cover with no colour in it (see
 * [coverAccent]), and the previous cover's while a new one is read.
 *
 * Read through the app's own image loader, so it is the same request the cover itself made (the
 * same agent, and usually straight from its cache), at a size that is plenty to find three colours
 * in. The colours are the platform's own reading, `WallpaperColors.fromBitmap`, as the live
 * wallpaper's are: it is already on the phone, and it is what the system would pick. That reading
 * arrived in Android 8.1, so 8.0 keeps the theme.
 */
@Composable
private fun rememberCoverAccent(url: String?, darkPage: Boolean): CoverAccent? {
    val context = LocalContext.current
    val accent by
        produceState<CoverAccent?>(initialValue = null, url, darkPage) {
            // The last record's colour stays while the next one's is read, so the controls go from
            // one cover's colour to the other's rather than through the theme's between them.
            if (url == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O_MR1) {
                value = null
                return@produceState
            }
            value =
                try {
                    val request = ImageRequest.Builder(context).data(url).allowHardware(false).size(COLOR_SAMPLE_PX).build()
                    // A cover that will not load keeps the colour it has: the screen still shows
                    // the last picture, and the next record is a few minutes away.
                    val bitmap = SingletonImageLoader.get(context).execute(request).image?.toBitmap() ?: return@produceState
                    withContext(Dispatchers.Default) {
                        val read = WallpaperColors.fromBitmap(bitmap)
                        coverAccent(listOfNotNull(read.primaryColor, read.secondaryColor, read.tertiaryColor).map { it.toArgb() }, darkPage)
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    null
                }
        }
    return accent
}

/** Plenty of pixels to find a cover's colours in, and few enough to read them in a blink. */
private const val COLOR_SAMPLE_PX = 128

private const val ACCENT_FADE_MS = 600
