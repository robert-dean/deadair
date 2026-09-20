package com.maroonedsoftware.deadair.wallpaper

/** Where the cover sits down the screen. */
enum class CoverPlacement {
    /** Under the status bar, where a phone's clock and notifications are. */
    TOP,

    /** Between the two, which is where least of the home screen is drawn. */
    MIDDLE,

    /** Above the dock and the search bar, where a phone's icons end. */
    BOTTOM,
}

/** Where the cover goes on the surface, in pixels. */
data class CoverBox(val left: Int, val top: Int, val side: Int)

/**
 * The square the cover is drawn in: as wide as the screen, and never larger than the screen's
 * shorter side.
 *
 * Never enlarged past the shorter side because a cover is square and filling a tall screen with one
 * means cutting most of it off — the same rule Now playing keeps. Where the square then sits is the
 * listener's, because what it has to live with is their home screen: the clock, the widgets, the
 * icons and the dock are all drawn over the wallpaper, and no arrangement of those is ours to guess.
 * The middle is the default for being the emptiest part of most of them.
 */
fun coverBox(width: Int, height: Int, placement: CoverPlacement = CoverPlacement.MIDDLE): CoverBox {
    val side = minOf(width, height).coerceAtLeast(0)
    val room = height - side
    val top =
        when (placement) {
            CoverPlacement.TOP -> 0
            CoverPlacement.MIDDLE -> room / 2
            CoverPlacement.BOTTOM -> room
        }
    return CoverBox(left = (width - side) / 2, top = top, side = side)
}
