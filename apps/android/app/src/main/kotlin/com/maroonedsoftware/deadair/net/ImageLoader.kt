package com.maroonedsoftware.deadair.net

import android.content.Context
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import okio.Path.Companion.toOkioPath

/**
 * How cover art is fetched.
 *
 * Over the app's one OkHttp client, so artwork carries the same User-Agent as everything else: HLS
 * listeners are counted per IP and agent, and a second agent from the same phone is a second
 * listener as far as the station can tell.
 *
 * A disk cache because `/api/art/{id}` is served with an ETag and an hour's `max-age`, and the art
 * for a record does not change. Without one, every poll that names the same record would refetch a
 * picture the phone already had.
 */
fun imageLoaderFactory(context: Context): SingletonImageLoader.Factory =
    SingletonImageLoader.Factory { platform: PlatformContext ->
        ImageLoader.Builder(platform)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { HttpClients.okHttp })) }
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("artwork").toOkioPath())
                    .maxSizeBytes(ART_CACHE_BYTES)
                    .build()
            }
            .crossfade(true)
            .build()
    }

/** Enough for a few hundred covers, which is more records than a station plays in a week. */
private const val ART_CACHE_BYTES = 64L * 1024 * 1024
