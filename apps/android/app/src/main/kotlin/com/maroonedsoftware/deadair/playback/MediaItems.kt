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
     */
    fun metadataFor(station: StationUrl, now: NowPlaying?): MediaMetadata {
        val track = now?.track
        return MediaMetadata.Builder()
            .setStation(now?.station)
            .setTitle(track?.title ?: now?.station)
            .setArtist(track?.artist)
            .setAlbumTitle(track?.album)
            .setArtworkUri(station.artUrl(track?.artworkUrl)?.toUri())
            .setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION)
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .build()
    }
}
