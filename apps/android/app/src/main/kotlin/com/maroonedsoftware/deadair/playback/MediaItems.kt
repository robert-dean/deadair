package com.maroonedsoftware.deadair.playback

import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import com.maroonedsoftware.deadair.sdk.models.NowPlaying
import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.station.StreamFormat

/** Turning a station and a format into something the player can be handed. */
object MediaItems {
    /** The root of what a car or another browser is offered. */
    const val ROOT_ID = "root"

    /** The station, the only thing there is to play. Every item handed to the player carries it. */
    const val STATION_ID = "station"

    /**
     * The root a car's media browser opens on: one folder, of radio stations, holding exactly one.
     */
    fun root(name: String): MediaItem =
        MediaItem.Builder()
            .setMediaId(ROOT_ID)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(name)
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_RADIO_STATIONS)
                    .build(),
            )
            .build()

    /**
     * The station as a car lists it: a name and nothing to fetch yet.
     *
     * No URI, because a browser in another process hands back only the `mediaId` when somebody
     * taps it, and the mount is chosen at that moment from the settings and the station's own
     * `mounts[]` (the session's `onAddMediaItems`). A second item, one per format say, would give
     * the player a real next item and a head unit a "next" that is not the operator's skip.
     */
    fun stationEntry(name: String): MediaItem =
        MediaItem.Builder()
            .setMediaId(STATION_ID)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(name)
                    .setStation(name)
                    .setIsBrowsable(false)
                    .setIsPlayable(true)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION)
                    .build(),
            )
            .build()

    /**
     * The item for one mount.
     *
     * The mime is a HINT, and it is what makes `DefaultMediaSourceFactory` pick an HLS source for
     * the playlist and a progressive one for the Icecast mounts without this code choosing either.
     *
     * HLS gets its playback speed pinned to 1.0. Left alone ExoPlayer time-stretches to hold its
     * target offset from the live edge, which is inaudible on speech and very audible on music —
     * and music is what this is.
     */
    @OptIn(UnstableApi::class)
    fun forMount(station: StationUrl, choice: MountChoice, metadata: MediaMetadata): MediaItem {
        val builder =
            MediaItem.Builder()
                .setMediaId(STATION_ID)
                .setUri(station.mountUrl(choice.path))
                .setMediaMetadata(metadata)

        return if (choice.format == StreamFormat.HLS) {
            builder
                .setMimeType(MimeTypes.APPLICATION_M3U8)
                .setLiveConfiguration(
                    MediaItem.LiveConfiguration.Builder()
                        .setMinPlaybackSpeed(1f)
                        .setMaxPlaybackSpeed(1f)
                        .build(),
                )
                .build()
        } else {
            builder.setMimeType(choice.format.mime).build()
        }
    }

    /**
     * What the lock screen, the notification and a Bluetooth head unit show.
     *
     * `MEDIA_TYPE_RADIO_STATION` rather than a music track, because that is what this is: no
     * seeking, no queue, no next. Players that read it lay their controls out accordingly.
     *
     * The artwork is a URI rather than bytes; the session's own loader fetches it, which means the
     * `/api/art` cache headers are honoured once rather than by every surface separately.
     *
     * What the three lines SAY is [lockScreenText]'s decision, kept apart so a JVM test can read
     * it: this function only needs `android.*` for the artwork URI.
     */
    fun metadataFor(station: StationUrl, now: NowPlaying?, words: LockScreenWords): MediaMetadata {
        val text = lockScreenText(now, words)
        return MediaMetadata.Builder()
            .setStation(now?.station)
            .setTitle(text.title)
            .setArtist(text.artist)
            .setAlbumTitle(text.album)
            .setArtworkUri(station.artUrl(now?.track?.artworkUrl)?.toUri())
            .setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION)
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .build()
    }
}
