package com.maroonedsoftware.deadair.ui

/**
 * One thing fetched once for one screen: a record, an album, a playlist's tracks.
 *
 * Distinct from the polled repositories' states on purpose. A detail page is read when it opens
 * and again when asked, not every few seconds, and it has no "stale" — the page either has the
 * answer or is still waiting for it.
 */
sealed interface LoadState<out T> {
    data object Loading : LoadState<Nothing>

    data class Loaded<T>(val value: T) : LoadState<T>

    /** The HTTP status when the station answered with one; `null` for no network at all. */
    data class Failed(val status: Int?) : LoadState<Nothing>
}
