package com.maroonedsoftware.deadair.wallpaper

import org.junit.Assert.assertEquals
import org.junit.Test

/** The cover is a square the width of the screen, centred, and never blown up past what fits. */
class CoverBoxTest {
    @Test
    fun `upright it is the full width, centred between the clock and the icons`() {
        assertEquals(CoverBox(left = 0, top = 660, side = 1080), coverBox(1080, 2400))
    }

    @Test
    fun `sideways it is the height instead, so nothing is cropped off the sides`() {
        assertEquals(CoverBox(left = 660, top = 0, side = 1080), coverBox(2400, 1080))
    }

    @Test
    fun `on a square surface it is the whole of it`() {
        assertEquals(CoverBox(left = 0, top = 0, side = 1000), coverBox(1000, 1000))
    }

    @Test
    fun `it sits where it is put, and keeps its size wherever that is`() {
        assertEquals(CoverBox(left = 0, top = 0, side = 1080), coverBox(1080, 2400, CoverPlacement.TOP))
        assertEquals(CoverBox(left = 0, top = 660, side = 1080), coverBox(1080, 2400, CoverPlacement.MIDDLE))
        assertEquals(CoverBox(left = 0, top = 1320, side = 1080), coverBox(1080, 2400, CoverPlacement.BOTTOM))
    }

    @Test
    fun `with no room to move, every placement is the same square`() {
        // A square surface, or a landscape one: the cover already fills the height.
        CoverPlacement.entries.forEach { placement ->
            assertEquals(CoverBox(left = 0, top = 0, side = 1000), coverBox(1000, 1000, placement))
        }
    }

    @Test
    fun `a surface with no size yet asks for nothing`() {
        assertEquals(CoverBox(left = 0, top = 0, side = 0), coverBox(0, 0))
    }
}
