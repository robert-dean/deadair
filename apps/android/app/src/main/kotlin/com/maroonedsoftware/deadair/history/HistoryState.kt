package com.maroonedsoftware.deadair.history

import com.maroonedsoftware.deadair.sdk.models.HistoryEntry

/**
 * What the Recently played tab has to show.
 *
 * `SignedOut` and an empty `Loaded` are different sentences — "the station keeps this for signed-in
 * listeners" and "nothing has aired yet" — and a state that could not tell them apart would tell a
 * listener to sign in to a station they are already signed in to.
 */
sealed interface HistoryState {
    data object SignedOut : HistoryState

    data object Loading : HistoryState

    /** Nothing has ever arrived, so there is not even a stale list to dim. */
    data object Unreachable : HistoryState

    data class Loaded(
        val entries: List<HistoryEntry>,
        /** There is more behind this, and `loadMore` will fetch it. */
        val canLoadMore: Boolean,
        val loadingMore: Boolean,
        /** The head poll is failing. What is listed was true a moment ago. */
        val stale: Boolean,
        /** When the head last answered, on the wall clock, so a stale list can say how old it is. */
        val lastGoodAtMs: Long? = null,
    ) : HistoryState
}
