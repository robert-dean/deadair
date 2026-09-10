package com.maroonedsoftware.deadair.ui.settings

import com.maroonedsoftware.deadair.station.StationCheck
import com.maroonedsoftware.deadair.station.StationUrl
import com.maroonedsoftware.deadair.ui.text.Message

/**
 * The address field, as the setup and settings screens both show it.
 *
 * Pure data with no Android in it, so the copy a listener reads for each outcome is decided by a
 * function a JVM test can call. The wording is the thing most likely to be wrong here, and it is
 * the thing hardest to check by looking at a screenshot.
 */
data class StationEntryState(
    val address: String = "",
    val checking: Boolean = false,
    /** Set once an address has answered, so the button can name the station rather than "Save". */
    val confirmedName: String? = null,
    val error: Message? = null,
    /** True when the entered address is plain HTTP, which is ordinary here and worth saying once. */
    val cleartext: Boolean = false,
    /**
     * The origin already kept, when there is one. What lets the settings screen tell an address
     * that has merely been loaded into the field from one that has been edited — the first has
     * nothing to check, and offering a Check button for it was two taps to achieve nothing.
     */
    val stored: String? = null,
) {
    /** What sits under the field: the error if there is one, else the confirmation, else the caution. */
    val supportingText: Message?
        get() =
            when {
                error != null -> error
                confirmedName != null -> Message.AnsweredAs(confirmedName)
                cleartext -> Message.NotEncrypted
                else -> null
            }

    /** The parsed URL, or `null` while what is typed is not one. */
    val parsed: StationUrl? get() = StationUrl.parse(address).getOrNull()

    /**
     * Whether there is anything to check.
     *
     * An address that has already answered has been checked; one that reads as the origin already
     * kept needs no checking. Everything else — including text that is not an address yet, which
     * Check answers with the reason — is worth a button.
     */
    val showsCheck: Boolean
        get() = confirmedName == null && (stored == null || parsed?.origin != stored)

    companion object {
        /** Typing again clears both verdicts: what was checked is no longer what is in the field. */
        fun typing(address: String, stored: String? = null): StationEntryState =
            StationEntryState(address = address, cleartext = address.trim().startsWith("http://", ignoreCase = true), stored = stored)

        /** What is in the field does not parse as an address at all. */
        fun invalid(address: String, stored: String? = null): StationEntryState = typing(address, stored).copy(error = Message.NotAnAddress)

        /** Turn a probe's answer into the state the field shows. */
        fun from(address: String, check: StationCheck, stored: String? = null): StationEntryState {
            val base = typing(address, stored)
            return when (check) {
                is StationCheck.Reachable -> base.copy(confirmedName = check.stationName)
                is StationCheck.Incompatible ->
                    base.copy(error = if (check.missing == null) Message.UnknownShape else Message.OlderApi(check.missing))
                is StationCheck.NotAStation ->
                    base.copy(error = if (check.status == null) Message.NotAStation else Message.AnsweredStatus(check.status))
                is StationCheck.Unreachable -> base.copy(error = Message.CouldNotReach)
                is StationCheck.Untrusted -> base.copy(error = Message.Untrusted)
            }
        }
    }
}
