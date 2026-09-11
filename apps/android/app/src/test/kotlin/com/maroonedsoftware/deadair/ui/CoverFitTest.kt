package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.ui.nowplaying.coverSide
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The cover gives way to the play button, and stops giving way before it is a stamp. The numbers are
 * the measured case, in pixels at 420dpi: a 1080x1920 phone leaves a 1373px viewport between the app
 * bar and the tabs, and the words and controls under the cover came to 801px. The same phone at
 * 1080x2400 leaves 1853px.
 */
class CoverFitTest {
    private val widest = 945 // 360dp, ArtworkMaxWidth
    private val minimum = 420 // 160dp
    private val breathing = 84 // 32dp

    @Test
    fun `a tall phone draws the cover as large as it ever was`() {
        assertEquals(widest, coverSide(viewport = 1853, under = 801, widest = widest, minimum = minimum, breathing = breathing))
    }

    @Test
    fun `a short phone shrinks the cover until the play button is on the first screen`() {
        val side = coverSide(viewport = 1373, under = 801, widest = widest, minimum = minimum, breathing = breathing)
        assertEquals(488, side)
        assertEquals(1373, side + 801 + breathing)
    }

    @Test
    fun `words that outgrow the screen leave the cover at its minimum and the column scrolls`() {
        assertEquals(minimum, coverSide(viewport = 1373, under = 1400, widest = widest, minimum = minimum, breathing = breathing))
    }

    @Test
    fun `a screen narrower than the minimum is never drawn past its own width`() {
        assertEquals(300, coverSide(viewport = 1373, under = 1400, widest = 300, minimum = minimum, breathing = breathing))
    }
}
