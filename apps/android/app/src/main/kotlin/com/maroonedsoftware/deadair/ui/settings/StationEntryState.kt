package com.maroonedsoftware.deadair.ui.settings

import com.maroonedsoftware.deadair.station.StationCheck
import com.maroonedsoftware.deadair.station.StationUrl

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
    val error: String? = null,
    /** True when the entered address is plain HTTP, which is ordinary here and worth saying once. */
    val cleartext: Boolean = false,
) {
    /** What sits under the field: the error if there is one, else the confirmation, else the caution. */
    val supportingText: String?
        get() =
            when {
                error != null -> error
                confirmedName != null -> "Answered as $confirmedName"
                cleartext -> "Not encrypted. Ordinary on a home network, where the station has no certificate."
                else -> null
            }

    /** The parsed URL, or `null` while what is typed is not one. */
    val parsed: StationUrl? get() = StationUrl.parse(address).getOrNull()

    companion object {
        /** Typing again clears both verdicts: what was checked is no longer what is in the field. */
        fun typing(address: String): StationEntryState =
            StationEntryState(address = address, cleartext = address.trim().startsWith("http://", ignoreCase = true))

        /** Turn a probe's answer into the state the field shows. */
        fun from(address: String, check: StationCheck): StationEntryState {
            val base = typing(address)
            return when (check) {
                is StationCheck.Reachable -> base.copy(confirmedName = check.stationName)
                is StationCheck.NotAStation ->
                    base.copy(
                        error =
                            if (check.status == null) {
                                "Something answered, but not a station. Check the address."
                            } else {
                                "Answered ${check.status}, which is not a station. Check the address."
                            },
                    )
                is StationCheck.Unreachable -> base.copy(error = "Could not reach it. Check the address and that you are on the right network.")
            }
        }
    }
}
