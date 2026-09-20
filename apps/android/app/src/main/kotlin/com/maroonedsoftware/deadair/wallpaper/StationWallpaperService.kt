package com.maroonedsoftware.deadair.wallpaper

import android.app.WallpaperColors
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.service.wallpaper.WallpaperService
import android.view.SurfaceHolder
import androidx.annotation.RequiresApi
import androidx.core.graphics.drawable.toBitmap
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.toBitmap
import com.maroonedsoftware.deadair.DeadairApp
import com.maroonedsoftware.deadair.R
import com.maroonedsoftware.deadair.nowplaying.AirState
import com.maroonedsoftware.deadair.nowplaying.NowPlayingState
import com.maroonedsoftware.deadair.nowplaying.airState
import com.maroonedsoftware.deadair.playback.PlayerConnection
import com.maroonedsoftware.deadair.settings.ListenerSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * The station, as the wallpaper.
 *
 * A live wallpaper the listener chooses from the system picker, and never a call to
 * `WallpaperManager.setBitmap`: writing the wallpaper directly would overwrite whatever they had,
 * and from Android 13 an app cannot read the current wallpaper back, so there would be nothing to
 * put returned when the station stopped. Chosen rather than taken, it is also theirs to undo —
 * they pick another wallpaper and this one is simply not running any more.
 *
 * **Nothing runs while it cannot be seen.** Every collection starts in `onVisibilityChanged(true)`
 * and is cancelled on the way out, so a home screen behind an app makes no requests, binds no
 * playback service and paints nothing. That matters more here than it usually would: a poll is a
 * line in the station's log, and the wallpaper is a surface that exists for as long as the phone
 * is on.
 *
 * **It reports fixed colours.** The phone derives its Material You palette from the wallpaper, so a
 * cover every three minutes would re-theme the whole device, and this app with it, several times an
 * hour. [onComputeColors] answers the station's own palette whatever is on screen, which keeps that
 * still.
 */
class StationWallpaperService : WallpaperService() {
    override fun onCreateEngine(): Engine = StationEngine()

    private inner class StationEngine : Engine() {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        private var connection: PlayerConnection? = null
        private var watching: Job? = null

        /** The surface's size, from the last `onSurfaceChanged`. Nothing is drawn before one. */
        private var width = 0
        private var height = 0

        /** What is on screen, so a reading that changes nothing does not repaint. */
        private var drawn: WallpaperScene? = null

        /** The last cover this wallpaper drew, which is what `LAST_COVER` keeps. */
        private var lastCover: String? = null
        private var cover: Bitmap? = null
        private var coverUrl: String? = null

        override fun onCreate(holder: SurfaceHolder) {
            super.onCreate(holder)
            // Nothing here reacts to a touch, and a wallpaper that asks for them wakes for every
            // swipe across the home screen.
            setTouchEventsEnabled(false)
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            this.width = width
            this.height = height
            // The cover was decoded for the old width, and the scene is unchanged, so a repaint has
            // to be asked for rather than waited on.
            cover = null
            coverUrl = null
            drawn = null
            scope.launch { show(sceneNow()) }
        }

        override fun onVisibilityChanged(visible: Boolean) {
            super.onVisibilityChanged(visible)
            if (visible) watch() else stopWatching()
        }

        override fun onDestroy() {
            stopWatching()
            scope.cancel()
            cover = null
            super.onDestroy()
        }

        /**
         * The station's own palette, whatever is on screen.
         *
         * Not the cover's colours, deliberately. Android derives the system theme from these, and a
         * station plays a record every three minutes: a wallpaper answering honestly here would
         * repaint every app on the phone that often, and restart the ones that follow the theme.
         */
        @RequiresApi(Build.VERSION_CODES.O_MR1)
        override fun onComputeColors(): WallpaperColors = WallpaperColors(Color.valueOf(CARBON), Color.valueOf(PHOSPHOR), null)

        /**
         * Watch what decides the scene, while the wallpaper is showing.
         *
         * The now-playing poll is collected only when the settings and the player say the answer
         * could be on screen: following this phone with nothing playing, the station is not asked
         * anything at all.
         */
        @OptIn(ExperimentalCoroutinesApi::class)
        private fun watch() {
            if (watching != null) return

            val graph = (application as DeadairApp).graph
            val player = connection ?: PlayerConnection(this@StationWallpaperService).also {
                connection = it
                it.connect()
            }

            watching =
                scope.launch {
                    combine(graph.settings.settings, player.state) { kept, playback -> kept to playback.requested }
                        .flatMapLatest { (kept, playing) ->
                            val asks = kept.wallpaperFollows == WallpaperFollows.STATION || playing
                            if (asks) {
                                graph.nowPlaying.state.map { now -> Triple(kept, playing, now) }
                            } else {
                                flowOf(Triple(kept, playing, NowPlayingState.Loading as NowPlayingState))
                            }
                        }
                        .map { (kept, playing, now) -> scene(kept, playing, now) }
                        .distinctUntilChanged()
                        .collect { scene -> show(scene) }
                }
        }

        private fun stopWatching() {
            watching?.cancel()
            watching = null
            connection?.release()
            connection = null
        }

        /** The scene from whatever is currently known, for a repaint nothing else asked for. */
        private fun sceneNow(): WallpaperScene = drawn ?: WallpaperScene.Plain

        private fun scene(kept: ListenerSettings, playing: Boolean, now: NowPlayingState): WallpaperScene {
            val air = airState(now, playing)
            val track = (now as? NowPlayingState.Answered)?.reading?.nowPlaying?.track
            return wallpaperScene(
                follows = kept.wallpaperFollows,
                idle = kept.wallpaperIdle,
                coverUrl = kept.station?.artUrl(track?.artworkUrl),
                airing = air is AirState.OnAir,
                playing = playing,
                lastCover = lastCover,
            )
        }

        /** Load whatever the scene needs, then paint it. */
        private suspend fun show(scene: WallpaperScene) {
            if (width == 0 || height == 0) return

            if (scene is WallpaperScene.Cover) {
                if (scene.url != coverUrl) {
                    val loaded = load(scene.url)
                    // A cover that will not load leaves what is there: a blank screen is worse than
                    // a picture that is one record old, and the next record is a few minutes away.
                    if (loaded == null) return
                    cover = loaded
                    coverUrl = scene.url
                }
                if (!scene.dimmed) lastCover = scene.url
            }

            drawn = scene
            paint(scene)
        }

        private suspend fun load(url: String): Bitmap? {
            val side = coverBox(width, height).side
            val request =
                ImageRequest.Builder(this@StationWallpaperService)
                    .data(url)
                    // A hardware bitmap cannot be drawn onto a surface's software canvas, which is
                    // what `lockCanvas` hands back.
                    .allowHardware(false)
                    .size(side.coerceAtLeast(1))
                    .build()
            val result = SingletonImageLoader.get(this@StationWallpaperService).execute(request)
            return runCatching { result.image?.toBitmap() }.getOrNull()
        }

        /**
         * One frame, and only when something changed.
         *
         * There is no animation loop: a wallpaper that redraws on a clock costs battery for as long
         * as the phone is unlocked, and what is on this one changes when the station changes record.
         */
        private fun paint(scene: WallpaperScene) {
            val holder = surfaceHolder
            val canvas = runCatching { holder.lockCanvas() }.getOrNull() ?: return
            try {
                canvas.drawColor(CARBON)
                when (scene) {
                    is WallpaperScene.Cover -> drawCover(canvas, scene.dimmed)
                    WallpaperScene.Mark -> drawMark(canvas)
                    WallpaperScene.Plain -> Unit
                }
            } finally {
                runCatching { holder.unlockCanvasAndPost(canvas) }
            }
        }

        private fun drawCover(canvas: Canvas, dimmed: Boolean) {
            val art = cover ?: return drawMark(canvas)
            val box = coverBox(width, height)
            val into = RectF(box.left.toFloat(), box.top.toFloat(), (box.left + box.side).toFloat(), (box.top + box.side).toFloat())
            canvas.drawBitmap(art, Rect(0, 0, art.width, art.height), into, PAINT)
            // Darkened where it is no longer what is playing, so the screen says which of the two
            // states it is in without a word on it.
            if (dimmed) canvas.drawRect(into, DIM)
        }

        private fun drawMark(canvas: Canvas) {
            val mark = getDrawable(R.drawable.ic_radio) ?: return
            val side = (minOf(width, height) / 4).coerceAtLeast(1)
            val bitmap = mark.toBitmap(side, side)
            canvas.drawBitmap(bitmap, ((width - side) / 2).toFloat(), ((height - side) / 2).toFloat(), MARK_PAINT)
        }
    }

    private companion object {
        /** The station's own background and green, from `ui/theme/Theme.kt`. */
        const val CARBON = 0xFF101214.toInt()
        const val PHOSPHOR = 0xFF3DDC91.toInt()

        val PAINT = Paint(Paint.FILTER_BITMAP_FLAG)
        val MARK_PAINT = Paint(Paint.FILTER_BITMAP_FLAG).apply { colorFilter = null; alpha = 120 }
        val DIM = Paint().apply { color = 0x8C000000.toInt() }
    }
}
