package com.maroonedsoftware.deadair.ui.nowplaying

/**
 * How big the cover is drawn upright, in pixels, given what has to fit under it.
 *
 * The cover takes what the screen has left once the words and the play button are measured, and
 * never more than [widest]. So on a tall phone it is the full-width square it always was, and on a
 * short one it gives way: a full-width square pushed the play button under the bottom bar at
 * 1080x1920, and the first screen a listener saw had no way to play. Measured, not reasoned about.
 *
 * It stops giving way at [minimum], where a cover stops being worth drawing. Past that point the
 * column scrolls rather than shrinking the cover to a stamp, which is what the largest accessibility
 * text size still needs: there the words alone can outgrow the screen, and no cover size fixes that.
 */
fun coverSide(viewport: Int, under: Int, widest: Int, minimum: Int, breathing: Int): Int =
    (viewport - under - breathing).coerceIn(minOf(minimum, widest), widest)
