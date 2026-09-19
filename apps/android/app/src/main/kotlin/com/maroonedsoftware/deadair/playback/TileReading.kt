package com.maroonedsoftware.deadair.playback

/**
 * What the Quick Settings tile shows, decided without Android so a JVM test can hold it.
 *
 * Four states rather than on and off, because the seconds after pressing play are warm-up (the
 * lease, the first record, the encoder) and a tile that sat at "off" through them would look like
 * the press had not landed.
 */
enum class TileReading {
    /** Nothing to play until a station has been chosen, which is done in the app. */
    NO_STATION,
    STOPPED,
    /** Asked for, and nothing coming out yet. */
    WARMING_UP,
    PLAYING,
}

/**
 * The tile's state from the kept station and the player.
 *
 * Read from `requested` rather than `playing`, as the app's own Play/Stop button is, so a press
 * turns the tile over at once and the two never disagree about whether the station is on.
 */
fun tileReading(hasStation: Boolean, player: PlayerUiState): TileReading =
    when {
        !hasStation -> TileReading.NO_STATION
        !player.requested -> TileReading.STOPPED
        player.playing -> TileReading.PLAYING
        else -> TileReading.WARMING_UP
    }
