package com.maroonedsoftware.deadair.ui.settings

import com.maroonedsoftware.deadair.auth.SignInResult

/**
 * The sign-in fields, as the settings screen shows them.
 *
 * Pure data with no Android in it, for the reason `StationEntryState` is: the copy a listener reads
 * for each outcome is the thing most likely to be wrong and the thing hardest to check by looking
 * at a screenshot.
 *
 * The password lives here while it is being typed and nowhere else. It is cleared the moment the
 * station answers — either way, because a wrong one is not worth keeping on screen and a right one
 * has already been traded for a token.
 */
data class AccountState(
    val email: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
) {
    /** Enough typed to be worth sending. Not validation: the station decides, and it is the only one that can. */
    val canSubmit: Boolean get() = !busy && email.isNotBlank() && password.isNotEmpty()

    companion object {
        /** Typing again clears the last answer: what failed is no longer what is in the fields. */
        fun typingEmail(current: AccountState, email: String): AccountState = current.copy(email = email, error = null)

        fun typingPassword(current: AccountState, password: String): AccountState = current.copy(password = password, error = null)

        /**
         * Turn the station's answer into what the fields show next.
         *
         * A refusal keeps the email and drops the password, which is the half that is probably
         * wrong and is certainly the one worth retyping. Anything else keeps both: a listener whose
         * station was unreachable should not have to type it all again once it is back.
         */
        fun from(current: AccountState, result: SignInResult): AccountState =
            when (result) {
                SignInResult.Ok -> AccountState()
                SignInResult.BadCredentials -> current.copy(password = "", busy = false, error = "That email and password did not work")
                is SignInResult.Failed ->
                    current.copy(
                        busy = false,
                        // The station's own words are not shown. They are an HTTP message or an
                        // exception, written for whoever wrote the station rather than for whoever
                        // is holding the phone, and neither tells a listener what to do next.
                        error = "Could not reach the station to sign in",
                    )
            }
    }
}
