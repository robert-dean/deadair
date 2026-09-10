package com.maroonedsoftware.deadair.playback

import com.maroonedsoftware.deadair.sdk.models.NowPlayingMount
import com.maroonedsoftware.deadair.station.StreamFormat

/** Which mount to play, and whether it is the one the listener asked for. */
data class MountChoice(
    val path: String,
    val format: StreamFormat,
    /** True when the chosen format was not available and MP3 was taken instead. Worth saying out loud. */
    val fellBack: Boolean,
)

/**
 * The mount to play, from what the station says it publishes.
 *
 * The paths come from `/nowplaying`'s `mounts[]` rather than being derived here. They are fixed on a
 * current station, but an older one took the MP3 path from a setting (`stream.mount`) an operator
 * could rename, and deriving them client-side would fail there in a way that looks like the stream
 * being down.
 *
 * MP3 is the floor because it is the only mount with no switch: the contract says the list is
 * never empty and MP3 is first. So a format the operator has turned off degrades to something
 * audible rather than to silence — but it says so, because a listener who chose FLAC and is
 * quietly given 128k MP3 has been lied to.
 */
fun chooseMount(mounts: List<NowPlayingMount>, wanted: StreamFormat): MountChoice {
    // Before the first reading there is nothing to choose from. `/live.mp3` is where every
    // current station publishes MP3, so it is the best guess available, and it is marked as a fallback whenever
    // it is not what was asked for.
    if (mounts.isEmpty()) return MountChoice(DEFAULT_MOUNT, StreamFormat.MP3, fellBack = wanted != StreamFormat.MP3)

    mounts.firstOrNull { it.format == wanted.wire }?.let { return MountChoice(it.path, wanted, fellBack = false) }

    val mp3 = mounts.firstOrNull { it.format == StreamFormat.MP3.wire }
    return if (mp3 != null) {
        MountChoice(mp3.path, StreamFormat.MP3, fellBack = true)
    } else {
        // The contract says this cannot happen. If it ever does, the first mount the station
        // named beats refusing to play anything.
        val first = mounts.first()
        MountChoice(first.path, StreamFormat.of(first.format) ?: StreamFormat.MP3, fellBack = true)
    }
}

/** Where a station publishes MP3, and the only sensible guess before it has answered. */
const val DEFAULT_MOUNT: String = "/live.mp3"
