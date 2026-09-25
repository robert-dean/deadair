package com.maroonedsoftware.deadair.ui.nowplaying

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/** The colour Now playing takes from a cover, and the colour that reads on it. Both ARGB. */
data class CoverAccent(val accent: Int, val onAccent: Int)

/**
 * Which of a cover's colours Now playing wears, or `null` to keep the theme's.
 *
 * Pure, and in ARGB integers rather than any Android colour type, so the rule is a JVM test: the
 * screen reads the cover's colours off the bitmap and hands them in.
 *
 * Three decisions. The MOST COLOURFUL candidate wins rather than the most common one, because a
 * cover is mostly its background and the colour worth carrying onto a button is the one that
 * stands out of it. A cover with no colour worth the name (black and white, or a grey photograph)
 * answers `null`, since a grey play button is a disabled-looking one and the theme's own accent is
 * better. And the winner's lightness is pulled into a band that reads on the page, lighter on a
 * dark page and darker on a light one, keeping its hue and saturation, so a navy cover on a dark
 * screen still gives a blue button a thumb can find.
 */
fun coverAccent(candidates: List<Int>, darkPage: Boolean): CoverAccent? {
    val best = candidates.maxByOrNull { chroma(it) } ?: return null
    if (chroma(best) < MIN_CHROMA) return null

    val (hue, saturation, lightness) = hsl(best)
    val band = if (darkPage) DARK_PAGE_BAND else LIGHT_PAGE_BAND
    val accent = fromHsl(hue, saturation, lightness.coerceIn(band))
    return CoverAccent(accent = accent, onAccent = readableOn(accent))
}

/** Black or white, whichever contrasts more with [background]. */
fun readableOn(background: Int): Int {
    val luminance = luminance(background)
    val againstBlack = (luminance + 0.05) / 0.05
    val againstWhite = 1.05 / (luminance + 0.05)
    return if (againstBlack >= againstWhite) BLACK else WHITE
}

/** Below this a colour is a grey, as far as a button is concerned. */
private const val MIN_CHROMA = 0.12f

/** Lightness a button needs to read on a dark page, and on a light one. */
private val DARK_PAGE_BAND = 0.58f..0.78f
private val LIGHT_PAGE_BAND = 0.28f..0.45f

private const val BLACK = 0xFF000000.toInt()
private const val WHITE = 0xFFFFFFFF.toInt()

private fun channels(argb: Int): Triple<Float, Float, Float> =
    Triple(((argb shr 16) and 0xFF) / 255f, ((argb shr 8) and 0xFF) / 255f, (argb and 0xFF) / 255f)

/** How far a colour is from grey: the spread between its strongest and weakest channel. */
private fun chroma(argb: Int): Float {
    val (r, g, b) = channels(argb)
    return max(r, max(g, b)) - min(r, min(g, b))
}

private fun hsl(argb: Int): Triple<Float, Float, Float> {
    val (r, g, b) = channels(argb)
    val high = max(r, max(g, b))
    val low = min(r, min(g, b))
    val lightness = (high + low) / 2f
    val delta = high - low
    if (delta == 0f) return Triple(0f, 0f, lightness)
    val saturation = delta / (1f - abs(2f * lightness - 1f))
    val hue =
        when (high) {
            r -> 60f * (((g - b) / delta).mod(6f))
            g -> 60f * ((b - r) / delta + 2f)
            else -> 60f * ((r - g) / delta + 4f)
        }
    return Triple(hue, saturation.coerceIn(0f, 1f), lightness)
}

private fun fromHsl(hue: Float, saturation: Float, lightness: Float): Int {
    val c = (1f - abs(2f * lightness - 1f)) * saturation
    val x = c * (1f - abs((hue / 60f).mod(2f) - 1f))
    val m = lightness - c / 2f
    val (r, g, b) =
        when {
            hue < 60f -> Triple(c, x, 0f)
            hue < 120f -> Triple(x, c, 0f)
            hue < 180f -> Triple(0f, c, x)
            hue < 240f -> Triple(0f, x, c)
            hue < 300f -> Triple(x, 0f, c)
            else -> Triple(c, 0f, x)
        }
    fun byte(v: Float) = ((v + m) * 255f).toInt().coerceIn(0, 255)
    return (0xFF shl 24) or (byte(r) shl 16) or (byte(g) shl 8) or byte(b)
}

/** WCAG relative luminance. */
private fun luminance(argb: Int): Double {
    val (r, g, b) = channels(argb)
    fun linear(v: Float): Double = if (v <= 0.03928f) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4)
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
