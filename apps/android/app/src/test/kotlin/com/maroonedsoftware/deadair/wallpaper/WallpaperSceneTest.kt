package com.maroonedsoftware.deadair.wallpaper

import org.junit.Assert.assertEquals
import org.junit.Test

/** Which of the two settings decides what is on the wallpaper, and what fills the gaps. */
class WallpaperSceneTest {
    private fun scene(
        follows: WallpaperFollows = WallpaperFollows.THIS_PHONE,
        idle: WallpaperIdle = WallpaperIdle.LAST_COVER,
        coverUrl: String? = "https://radio.example.com/art/now.jpg",
        airing: Boolean = true,
        playing: Boolean = true,
        lastCover: String? = null,
    ) = wallpaperScene(follows, idle, coverUrl, airing, playing, lastCover)

    @Test
    fun `following this phone, the cover is up only while this phone plays it`() {
        assertEquals(WallpaperScene.Cover("https://radio.example.com/art/now.jpg"), scene())
        // On air to somebody else is not this phone listening.
        assertEquals(WallpaperScene.Mark, scene(playing = false, idle = WallpaperIdle.MARK))
    }

    @Test
    fun `following the station, what airs is up whoever is listening`() {
        val station = WallpaperFollows.STATION

        assertEquals(WallpaperScene.Cover("https://radio.example.com/art/now.jpg"), scene(follows = station, playing = false))
        assertEquals(WallpaperScene.Mark, scene(follows = station, airing = false, playing = true, idle = WallpaperIdle.MARK))
    }

    @Test
    fun `a break, and a record the station has no art for, are both nothing to show`() {
        // Neither is what is playing, and the idle setting is the listener's answer to that.
        assertEquals(WallpaperScene.Plain, scene(coverUrl = null, idle = WallpaperIdle.PLAIN))
    }

    @Test
    fun `the last cover is kept, dimmed, and only while it is no longer what is playing`() {
        val kept = scene(playing = false, lastCover = "https://radio.example.com/art/before.jpg")

        assertEquals(WallpaperScene.Cover("https://radio.example.com/art/before.jpg", dimmed = true), kept)
    }

    @Test
    fun `with nothing ever drawn, keeping the last cover shows the mark instead of a blank`() {
        assertEquals(WallpaperScene.Mark, scene(playing = false, lastCover = null))
    }

    @Test
    fun `plain and the mark ignore whatever was drawn before`() {
        val before = "https://radio.example.com/art/before.jpg"

        assertEquals(WallpaperScene.Plain, scene(playing = false, idle = WallpaperIdle.PLAIN, lastCover = before))
        assertEquals(WallpaperScene.Mark, scene(playing = false, idle = WallpaperIdle.MARK, lastCover = before))
    }
}
