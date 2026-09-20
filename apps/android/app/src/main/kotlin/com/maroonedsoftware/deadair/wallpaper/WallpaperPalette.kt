package com.maroonedsoftware.deadair.wallpaper

/**
 * What the phone takes its Material You colors from while this wallpaper is up.
 *
 * Not `WallpaperColors`, which is the platform's own type for the answer this feeds: one name for
 * both, in a file that hands one to the other, is a compile error at best and the wrong import at
 * worst.
 */
enum class ColorSource {
    /** The station's own green on carbon. The phone's palette then never moves, whatever is playing. */
    STATION,

    /** The cover on screen. The phone re-themes itself every time the station changes record. */
    ARTWORK,

    /** One color, chosen once. */
    CUSTOM,
}

/** The pair a wallpaper hands the system: what it is mostly, and the color to accent from. */
data class Palette(val background: Int, val accent: Int)

/** The station's own, from `ui/theme/Theme.kt`. */
val STATION_PALETTE = Palette(background = 0xFF101214.toInt(), accent = 0xFF3DDC91.toInt())

/**
 * The colors to report, which is what the phone themes itself from.
 *
 * Pure, so the rule survives being read off a bitmap somewhere else: the engine extracts the
 * cover's colors when it has a cover and passes them in, and this says whether they are what the
 * phone should hear about.
 *
 * Two fallbacks, and both matter. Following the cover with nothing drawn yet — a fresh install, a
 * station off air — leaves the phone on the station's palette rather than on nothing. And a custom
 * color is only ever a color somebody picked; there is no "unset" for it, because the picker
 * starts on the station's green and every swatch is a real answer.
 */
fun wallpaperPalette(source: ColorSource, custom: Int, cover: Palette?): Palette =
    when (source) {
        ColorSource.STATION -> STATION_PALETTE
        ColorSource.ARTWORK -> cover ?: STATION_PALETTE
        ColorSource.CUSTOM -> Palette(background = STATION_PALETTE.background, accent = custom)
    }

/**
 * The colors offered for [ColorSource.CUSTOM].
 *
 * A row of swatches rather than a wheel: a wheel is a dependency and a fiddle on a phone, and what
 * this actually decides is the accent the whole system derives from — a job a dozen good colors do
 * as well as sixteen million, most of which make an unreadable phone. The station's own green is
 * first, so the picker opens on something that is already right.
 */
val WALLPAPER_SWATCHES =
    listOf(
        0xFF3DDC91.toInt(), // the station's green
        0xFF5FF9AC.toInt(),
        0xFF7FD4F5.toInt(),
        0xFF6E9BFF.toInt(),
        0xFFB39DFF.toInt(),
        0xFFFF9ECF.toInt(),
        0xFFFF8A80.toInt(),
        0xFFFFB067.toInt(),
        0xFFF5D06B.toInt(),
        0xFFC8E06B.toInt(),
        0xFFB0BEC5.toInt(),
        0xFFFFFFFF.toInt(),
        // The two dark ones last, and they are real answers rather than an absence: a phone themed
        // from near-black is a phone that stops coloring itself, which is a thing to want.
        0xFF4A5054.toInt(),
        0xFF000000.toInt(),
    )
