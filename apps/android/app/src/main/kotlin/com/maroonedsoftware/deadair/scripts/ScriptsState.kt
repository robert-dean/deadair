package com.maroonedsoftware.deadair.scripts

import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt

/** What the station has said, newest first, as the screen has it. */
sealed interface ScriptsState {
    data object SignedOut : ScriptsState

    data object Loading : ScriptsState

    data object Unreachable : ScriptsState

    data class Loaded(
        val attempts: List<ScriptAttempt>,
        val canLoadMore: Boolean,
        val loadingMore: Boolean,
        val stale: Boolean,
        val lastGoodAtMs: Long? = null,
    ) : ScriptsState
}
