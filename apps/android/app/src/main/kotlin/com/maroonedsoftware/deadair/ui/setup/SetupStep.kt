package com.maroonedsoftware.deadair.ui.setup

/**
 * Which half of setup is showing: the welcome, or the address.
 *
 * Held by the setup screen itself rather than pushed as a destination, because setup sits above
 * the stack on purpose (see `MainActivity`) and back is not meant to reach it.
 */
enum class SetupStep {
    WELCOME,
    STATION;

    companion object {
        /**
         * Where setup opens. A `deadair://` link has already chosen a station and put it in the
         * field, so a welcome in front of that field would be one more tap for nothing.
         */
        fun initial(proposing: Boolean): SetupStep = if (proposing) STATION else WELCOME
    }
}
