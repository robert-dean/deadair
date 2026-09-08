package com.maroonedsoftware.deadair.station

import com.maroonedsoftware.deadair.sdk.models.NowPlayingMountFormat

/**
 * A way of listening, as the picker offers it.
 *
 * Keyed on the generated enum rather than restating the wire strings, so a format added to the
 * contract is a compile error here rather than a silent mismatch.
 *
 * The order is the order the picker shows, which is the order a listener would rank them: the
 * mount everyone has, then the one that survives a network change, then the better codecs.
 */
enum class StreamFormat(val wire: NowPlayingMountFormat, val label: String, val mime: String) {
    /** Always published. `stream.mount` has no switch, so this is the only format guaranteed to exist. */
    MP3(NowPlayingMountFormat.MP3, "MP3", "audio/mpeg"),

    /**
     * The one to choose on a phone. An Icecast mount is a single long-lived TCP connection, so
     * moving between wifi and mobile data kills it; HLS is a sequence of requests and survives.
     */
    HLS(NowPlayingMountFormat.HLS, "HLS", "application/x-mpegURL"),
    AAC(NowPlayingMountFormat.AAC, "AAC", "audio/aac"),
    OPUS(NowPlayingMountFormat.OPUS, "Opus", "audio/ogg"),
    FLAC(NowPlayingMountFormat.FLAC, "FLAC", "audio/flac"),
    ;

    companion object {
        /** The format for a wire value, or `null` for one this build does not know. */
        fun of(wire: NowPlayingMountFormat): StreamFormat? = entries.firstOrNull { it.wire == wire }
    }
}
