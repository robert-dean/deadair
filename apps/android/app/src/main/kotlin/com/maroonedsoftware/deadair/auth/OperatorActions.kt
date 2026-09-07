package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.DeadairSdk
import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** The two things an operator action needs of the session: a signed-in SDK, and a way to re-ask who it is. */
interface OperatorSession {
    suspend fun <T> withSession(block: suspend (DeadairSdk) -> T): T

    suspend fun refreshRoles()
}

/**
 * Something the operator should be told about an action, named rather than worded so the words
 * live in `strings.xml` with the rest of the app's copy.
 */
sealed interface Notice {
    /** The station answered 403: the cached role was wrong, and has been re-read. */
    data object NoLongerOperator : Notice

    /** Start on a station that was never put on air. There is nothing to resume. */
    data object NothingToResume : Notice

    /** Airing a playlist with no tracks the station can play. */
    data object PlaylistEmpty : Notice

    /** A persona picked from a list the station has since changed. The list is stale, not the choice. */
    data object HostGone : Notice

    /** The station could not be reached to ask. */
    data object CouldNotReach : Notice

    /** The station refused for a reason this app has no sentence for. Carries the status for the operator's eyes. */
    data class Failed(val status: Int) : Notice
}

/**
 * How every `platform.manage` call from the phone is made.
 *
 * One path for all of them so one rule holds everywhere: **the API is the gate and the cached role
 * is a hint.** A control is drawn because the last `GET /auth/session` said `admin`; the station
 * may have changed its mind since, and a 403 here is how the phone finds out. It re-reads the roles
 * — which redraws the screen without the controls — and says so once, rather than leaving a button
 * that fails silently on every press.
 *
 * Failures come out as a `Notice` on a flow rather than as exceptions at the call site, because
 * every call site would otherwise catch the same three things and show the same snackbar.
 */
class OperatorActions(private val session: OperatorSession) {
    private val _notices = MutableSharedFlow<Notice>(extraBufferCapacity = 8)

    /** What the operator should be told. Shown once, by whoever is on screen. */
    val notices: SharedFlow<Notice> = _notices.asSharedFlow()

    /**
     * Make one call. Answers what the station answered, or `null` after posting a notice.
     *
     * `expected` names the statuses that mean something in particular for this action — a 409
     * from Start is "nothing to resume", not a fault — and everything else the station refuses is
     * reported with its number.
     */
    suspend fun <T> run(expected: Map<Int, Notice> = emptyMap(), action: suspend (DeadairSdk) -> T): T? =
        try {
            session.withSession(action)
        } catch (error: SdkError) {
            when {
                error.status == FORBIDDEN -> {
                    runCatching { session.refreshRoles() }
                    _notices.tryEmit(Notice.NoLongerOperator)
                }
                error.status in expected -> _notices.tryEmit(expected.getValue(error.status))
                else -> _notices.tryEmit(Notice.Failed(error.status))
            }
            null
        } catch (error: NotSignedInException) {
            // The session ended under the press. The screen is already redrawing without the control.
            null
        } catch (error: Exception) {
            _notices.tryEmit(Notice.CouldNotReach)
            null
        }

    private companion object {
        const val FORBIDDEN = 403
    }
}
