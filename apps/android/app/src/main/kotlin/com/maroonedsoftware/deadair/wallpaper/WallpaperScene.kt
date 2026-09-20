package com.maroonedsoftware.deadair.wallpaper

/** When the wallpaper shows what is on: while this phone is playing it, or whenever the station airs at all. */
enum class WallpaperFollows {
    /**
     * This phone. The wallpaper asks the station nothing while you are not listening, which is most
     * of the day on most phones, so an idle home screen costs no requests and no battery.
     */
    THIS_PHONE,

    /** The station. What is on air is on the wallpaper, whoever is listening, for as long as the home screen is showing. */
    STATION,
}

/** What the wallpaper shows when there is no cover to show: between records, off air, or stopped. */
enum class WallpaperIdle {
    /** The last cover, darkened. Keeps the screen from jumping between a picture and a blank every break. */
    LAST_COVER,

    /** The station's mark on its own background. */
    MARK,

    /** The station's background and nothing on it. */
    PLAIN,
}

/** What the wallpaper draws, once everything that decides it has been read. */
sealed interface WallpaperScene {
    /** A cover, at full width. [dimmed] is the one that is no longer what is playing. */
    data class Cover(val url: String, val dimmed: Boolean = false) : WallpaperScene

    data object Mark : WallpaperScene

    data object Plain : WallpaperScene
}

/**
 * What to draw, from the settings and what the station is doing.
 *
 * Pure, and the whole of the decision: the engine below it only loads and paints what this says.
 * Every input is something somebody else already knows — the two settings, the cover the station
 * named, whether it is airing, whether this phone is playing it — so the rule about which of them
 * wins is testable without a surface to draw on.
 *
 * A record with no artwork and a break both arrive as no cover while the station is airing, and
 * both take the idle branch: what is on screen at that moment is not what is playing either way,
 * and the setting is the listener's answer to that.
 */
fun wallpaperScene(
    follows: WallpaperFollows,
    idle: WallpaperIdle,
    /** The cover the station names for what is on, resolved against the station's address. */
    coverUrl: String?,
    /** Whether the station is airing anything at all. */
    airing: Boolean,
    /** Whether this phone is playing it. */
    playing: Boolean,
    /** The last cover this wallpaper drew, for [WallpaperIdle.LAST_COVER]. Absent until it has drawn one. */
    lastCover: String?,
): WallpaperScene {
    val showing =
        when (follows) {
            WallpaperFollows.THIS_PHONE -> playing
            WallpaperFollows.STATION -> airing
        }
    if (showing && coverUrl != null) return WallpaperScene.Cover(coverUrl)

    return when (idle) {
        // The mark rather than a blank on a phone that has never drawn a cover: the setting is
        // about keeping the last picture, and on the first day there is none to keep.
        WallpaperIdle.LAST_COVER -> lastCover?.let { WallpaperScene.Cover(it, dimmed = true) } ?: WallpaperScene.Mark
        WallpaperIdle.MARK -> WallpaperScene.Mark
        WallpaperIdle.PLAIN -> WallpaperScene.Plain
    }
}
