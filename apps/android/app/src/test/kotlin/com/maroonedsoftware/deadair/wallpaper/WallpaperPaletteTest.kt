package com.maroonedsoftware.deadair.wallpaper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the phone themes itself from while the station is the wallpaper. */
class WallpaperPaletteTest {
    private val cover = Palette(background = 0xFF2A1B10.toInt(), accent = 0xFFE2A25A.toInt())

    @Test
    fun `the station's palette does not move, whatever is on screen`() {
        assertEquals(STATION_PALETTE, wallpaperPalette(ColorSource.STATION, custom = 0xFFFF0000.toInt(), cover = cover))
    }

    @Test
    fun `following the cover reports the cover`() {
        assertEquals(cover, wallpaperPalette(ColorSource.ARTWORK, custom = 0xFFFF0000.toInt(), cover = cover))
    }

    @Test
    fun `following the cover with nothing drawn yet falls back to the station rather than to nothing`() {
        // A fresh install, or a station that has not aired anything since the wallpaper went up.
        assertEquals(STATION_PALETTE, wallpaperPalette(ColorSource.ARTWORK, custom = 0xFFFF0000.toInt(), cover = null))
    }

    @Test
    fun `a chosen color accents the station's own background`() {
        val picked = wallpaperPalette(ColorSource.CUSTOM, custom = 0xFF6E9BFF.toInt(), cover = cover)

        assertEquals(0xFF6E9BFF.toInt(), picked.accent)
        // The wallpaper is still drawn on carbon; this setting is about the phone's palette.
        assertEquals(STATION_PALETTE.background, picked.background)
    }

    @Test
    fun `the swatches open on the station's own green, and are all opaque`() {
        assertEquals(STATION_PALETTE.accent, WALLPAPER_SWATCHES.first())
        assertTrue(WALLPAPER_SWATCHES.all { (it ushr 24) == 0xFF })
        assertEquals(WALLPAPER_SWATCHES.distinct(), WALLPAPER_SWATCHES)
    }

    @Test
    fun `a phone can be themed from something almost colorless`() {
        // Black is a color somebody picks on purpose, and it is not the same as picking nothing.
        assertTrue(0xFF000000.toInt() in WALLPAPER_SWATCHES)
        assertEquals(0xFF000000.toInt(), wallpaperPalette(ColorSource.CUSTOM, custom = 0xFF000000.toInt(), cover = cover).accent)
    }
}
