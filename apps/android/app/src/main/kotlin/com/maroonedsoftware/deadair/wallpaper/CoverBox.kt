package com.maroonedsoftware.deadair.wallpaper

/** Where the cover goes on the surface, in pixels. */
data class CoverBox(val left: Int, val top: Int, val side: Int)

/**
 * The square the cover is drawn in: as wide as the screen, centred, and never larger than the
 * screen's shorter side.
 *
 * Centred rather than pinned to the top because the clock, the notifications and the app icons are
 * all drawn over the wallpaper and all live at the edges. Never enlarged past the shorter side
 * because a cover is square and filling a tall screen with one means cutting most of it off —
 * the same rule Now playing keeps.
 */
fun coverBox(width: Int, height: Int): CoverBox {
    val side = minOf(width, height).coerceAtLeast(0)
    return CoverBox(left = (width - side) / 2, top = (height - side) / 2, side = side)
}
