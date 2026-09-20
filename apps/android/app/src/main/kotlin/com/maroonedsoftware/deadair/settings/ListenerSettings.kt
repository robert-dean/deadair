package com.maroonedsoftware.deadair.settings

import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.wallpaper.STATION_PALETTE
import com.maroonedsoftware.deadair.wallpaper.ColorSource
import com.maroonedsoftware.deadair.wallpaper.CoverPlacement
import com.maroonedsoftware.deadair.wallpaper.WallpaperFollows
import com.maroonedsoftware.deadair.wallpaper.WallpaperIdle
import com.maroonedsoftware.deadair.station.StreamFormat
import com.maroonedsoftware.deadair.widget.WidgetFollows

/**
 * Everything this app remembers about how to listen.
 *
 * `station` is absent until somebody has named one, which is what the setup screen tests for.
 * `stationName` is what that station called itself when it was checked, kept so the app bar has a
 * name to show before the first `/nowplaying` answer arrives and while the station is unreachable
 * — the alternative was a raw URL in the title, which is what it drew.
 */
data class ListenerSettings(
    val station: StationUrl? = null,
    val stationName: String? = null,
    val format: StreamFormat = StreamFormat.MP3,
    /** Colors from the wallpaper where the phone offers them, or the station's own. On by default, because a listener's palette is a better default than ours. */
    val dynamicColor: Boolean = true,
    /** Start the station when the app opens. Off by default: opening an app is not always wanting to hear it. */
    val playOnOpen: Boolean = false,
    /** When the station wallpaper shows a cover. This phone by default, which is the version that asks the station nothing while nobody is listening. */
    val wallpaperFollows: WallpaperFollows = WallpaperFollows.THIS_PHONE,
    /** What the station wallpaper shows with no cover to show. */
    val wallpaperIdle: WallpaperIdle = WallpaperIdle.LAST_COVER,
    /** Where the station wallpaper's cover sits down the screen. */
    val wallpaperPlacement: CoverPlacement = CoverPlacement.MIDDLE,
    /** What the phone takes its own colors from while the station wallpaper is up. */
    val wallpaperColorSource: ColorSource = ColorSource.STATION,
    /** The color behind [ColorSource.CUSTOM], as ARGB. The station's green until somebody picks another. */
    val wallpaperColor: Int = STATION_PALETTE.accent,
    /** When the home-screen widget shows what is on. This phone by default, which asks the station nothing while nobody here is listening. */
    val widgetFollows: WidgetFollows = WidgetFollows.THIS_PHONE,
)
