package com.maroonedsoftware.deadair.ui.nowplaying

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Which of a cover's colours Now playing wears, and that it reads on the page it is worn on. */
class CoverAccentTest {
    private val black = 0xFF000000.toInt()
    private val white = 0xFFFFFFFF.toInt()
    private val grassGreen = 0xFF3A9A4A.toInt()
    private val offWhite = 0xFFEDE8E0.toInt()
    private val navy = 0xFF14244A.toInt()
    private val paleYellow = 0xFFF8EFA0.toInt()

    @Test
    fun `wears the most colourful of the cover's colours, not its background`() {
        val accent = coverAccent(listOf(offWhite, grassGreen, black), darkPage = true)!!

        assertTrue("green should win", green(accent.accent) > red(accent.accent) && green(accent.accent) > blue(accent.accent))
    }

    @Test
    fun `keeps the theme for a cover with no colour in it`() {
        assertNull(coverAccent(listOf(black, white, 0xFF808080.toInt()), darkPage = true))
    }

    @Test
    fun `keeps the theme when the cover gave nothing`() {
        assertNull(coverAccent(emptyList(), darkPage = true))
    }

    @Test
    fun `lifts a dark colour until it reads on a dark page, keeping it blue`() {
        val accent = coverAccent(listOf(navy), darkPage = true)!!

        assertTrue("lighter than the navy it came from", lightness(accent.accent) > lightness(navy))
        assertTrue("still blue", blue(accent.accent) > red(accent.accent) && blue(accent.accent) > green(accent.accent))
    }

    @Test
    fun `darkens a pale colour until it reads on a light page`() {
        val accent = coverAccent(listOf(paleYellow), darkPage = false)!!

        assertTrue(lightness(accent.accent) < lightness(paleYellow))
    }

    @Test
    fun `puts black on a light accent and white on a dark one`() {
        assertEquals(black, coverAccent(listOf(paleYellow), darkPage = true)!!.onAccent)
        assertEquals(white, coverAccent(listOf(navy), darkPage = false)!!.onAccent)
    }

    @Test
    fun `reads black on white and white on black`() {
        assertEquals(black, readableOn(white))
        assertEquals(white, readableOn(black))
    }

    private fun red(argb: Int) = (argb shr 16) and 0xFF

    private fun green(argb: Int) = (argb shr 8) and 0xFF

    private fun blue(argb: Int) = argb and 0xFF

    private fun lightness(argb: Int) = (maxOf(red(argb), green(argb), blue(argb)) + minOf(red(argb), green(argb), blue(argb))) / 2
}
