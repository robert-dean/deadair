package com.maroonedsoftware.deadair.auth

import kotlinx.coroutines.flow.Flow

/**
 * Where a session is kept, as the rest of the app needs to see it.
 *
 * An interface for one implementation, which is a shape this codebase otherwise avoids. The reason
 * is the same one `NowPlayingRepository` takes a `suspend` function rather than the SDK: what
 * `SessionManager` is FOR is the policy — when to refresh, when to give up, what a station change
 * means — and none of that needs a DataStore, or an Android runtime, to be exercised. Keeping the
 * seam here is what lets the refresh rules be tested on the JVM at all.
 */
interface SessionStorage {
    /** The session on disk, or `null` when there is none. Re-read on change, like every other store here. */
    val stored: Flow<StoredSession?>

    suspend fun save(session: StoredSession)

    suspend fun clear()
}
