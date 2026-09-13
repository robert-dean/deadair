package com.maroonedsoftware.deadair.playback

import android.os.Bundle
import androidx.media3.session.SessionCommand

/**
 * How the screen reaches the sleep timer in the service, and how the service says where it stands.
 *
 * Custom session commands carry the request in, because the screen and the service are joined only
 * by the media session; the session's extras carry the state out, because the screen needs it on
 * every connect and on every change without asking. Both are in one process, so a deadline on
 * `elapsedRealtime` means the same thing at each end. The `Bundle` work lives here so that
 * `SleepTimer` stays free of `android.*`.
 */
object SleepCommands {
    val ARM = SessionCommand("com.maroonedsoftware.deadair.SLEEP_ARM", Bundle.EMPTY)
    val CLEAR = SessionCommand("com.maroonedsoftware.deadair.SLEEP_CLEAR", Bundle.EMPTY)

    private const val MINUTES = "minutes"
    private const val AFTER_RECORD = "after_record"
    private const val DEADLINE = "sleep_deadline_ms"

    fun request(request: SleepRequest): Bundle =
        Bundle().apply {
            when (request) {
                is SleepRequest.Minutes -> putLong(MINUTES, request.minutes)
                SleepRequest.AfterRecord -> putBoolean(AFTER_RECORD, true)
            }
        }

    /** The request a command carried, or `null` for one that says nothing this build understands. */
    fun requestOf(args: Bundle): SleepRequest? =
        when {
            args.getBoolean(AFTER_RECORD) -> SleepRequest.AfterRecord
            args.getLong(MINUTES) > 0 -> SleepRequest.Minutes(args.getLong(MINUTES))
            else -> null
        }

    /** The state as session extras. An empty bundle is off. */
    fun extras(state: SleepState): Bundle =
        Bundle().apply {
            when (state) {
                SleepState.Off -> Unit
                is SleepState.Until -> putLong(DEADLINE, state.deadlineMs)
                is SleepState.AfterRecord -> {
                    putBoolean(AFTER_RECORD, true)
                    state.deadlineMs?.let { putLong(DEADLINE, it) }
                }
            }
        }

    fun stateOf(extras: Bundle): SleepState =
        when {
            extras.getBoolean(AFTER_RECORD) -> SleepState.AfterRecord(if (extras.containsKey(DEADLINE)) extras.getLong(DEADLINE) else null)
            extras.containsKey(DEADLINE) -> SleepState.Until(extras.getLong(DEADLINE))
            else -> SleepState.Off
        }
}
