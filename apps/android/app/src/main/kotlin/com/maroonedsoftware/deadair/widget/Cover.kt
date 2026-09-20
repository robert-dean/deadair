package com.maroonedsoftware.deadair.widget

import android.content.Context
import android.graphics.Bitmap
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.toBitmap

/**
 * How big a cover the widget asks for.
 *
 * Not the source's size, and the cap is not tidiness. A widget's drawing crosses a binder
 * transaction into the launcher's process, and that transaction has a hard ceiling for the whole
 * app: a full-size cover is megabytes and takes the home screen down with it. This is a square of a
 * quarter of a megabyte, which is more than a row of a home screen can show.
 */
const val COVER_PX = 256

/**
 * The cover, as a bitmap the launcher can be handed.
 *
 * Through the app's one image loader, so artwork is fetched over the same OkHttp client as
 * everything else — one User-Agent from this phone, and the disk cache that already holds the cover
 * the screen or the notification fetched a moment ago.
 *
 * `allowHardware(false)` is not optional: a hardware bitmap has no pixels to parcel, and
 * `RemoteViews` is nothing but parcelled pixels. The live wallpaper says the same thing for a
 * different reason, which is a good sign the rule belongs to the bitmap rather than to either.
 */
suspend fun coverBitmap(context: Context, url: String): Bitmap? {
    val request = ImageRequest.Builder(context).data(url).allowHardware(false).size(COVER_PX).build()
    val result = SingletonImageLoader.get(context).execute(request)
    return runCatching { result.image?.toBitmap() }.getOrNull()
}
