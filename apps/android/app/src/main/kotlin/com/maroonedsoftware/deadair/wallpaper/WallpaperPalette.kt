package com.maroonedsoftware.deadair.wallpaper

/** What the phone takes its Material You colours from while this wallpaper is up. */
enum class WallpaperColours {
    /** The station's own green on carbon. The phone's palette then never moves, whatever is playing. */
    STATION,

    /** The cover on screen. The phone re-themes itself every time the station changes record. */
    ARTWORK,

    /** One colour, chosen once. */
    CUSTOM,
}

/** The pair a wallpaper hands the system: what it is mostly, and the colour to accent from. */
data class Palette(val background: Int, val accent: Int)

/** The station's own, from `ui/theme/Theme.kt`. */
val STATION_PALETTE = Palette(background = 0xFF101214.toInt(), accent = 0xFF3DDC91.toInt())

/**
 * The colours to report, which is what the phone themes itself from.
 *
 * Pure, so the rule survives being read off a bitmap somewhere else: the engine extracts the
 * cover's colours when it has a cover and passes them in, and this says whether they are what the
 * phone should hear about.
 *
 * Two fallbacks, and both matter. Following the cover with nothing drawn yet — a fresh install, a
 * station off air — leaves the phone on the station's palette rather than on nothing. And a custom
 * colour is only ever a colour somebody picked; there is no "unset" for it, because the picker
 * starts on the station's green and every swatch is a real answer.
 */
fun wallpaperPalette(source: WallpaperColours, custom: Int, cover: Palette?): Palette =
    when (source) {
        WallpaperColours.STATION -> STATION_PALETTE
        WallpaperColours.ARTWORK -> cover ?: STATION_PALETTE
        WallpaperColours.CUSTOM -> Palette(background = STATION_PALETTE.background, accent = custom)
    }

/**
 * The colours offered for [WallpaperColours.CUSTOM].
 *
 * A row of swatches rather than a wheel: a wheel is a dependency and a fiddle on a phone, and what
 * this actually decides is the accent the whole system derives from — a job a dozen good colours do
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
    )
