package com.maroonedsoftware.deadair.ui.settings

import com.maroonedsoftware.deadair.auth.SignInResult
import com.maroonedsoftware.deadair.auth.authenticatorFactors
import com.maroonedsoftware.deadair.ui.text.Message

/**
 * The challenge a code is being typed against.
 *
 * Both halves, because the station needs both: the challenge says which pending sign-in this is,
 * and the method id says which enrolled authenticator the six digits are supposed to be from. TOTP
 * has no other binding to the actor at initial login, so a code sent without the right method id is
 * refused — and refused in a way that reads at the keyboard exactly like a wrong code.
 */
data class SecondFactor(val challengeId: String, val methodId: String)

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
 *
 * Two steps rather than one, and which one is showing is [challenge] rather than a flag: the code
 * step needs the challenge's identifiers to send anything at all, so a boolean saying "on the code
 * step" would be a second copy of the answer that can disagree with the first.
 */
data class AccountState(
    val email: String = "",
    val password: String = "",
    val code: String = "",
    /** Set once the station has asked for a second factor, and the only thing that draws the code box. */
    val challenge: SecondFactor? = null,
    val busy: Boolean = false,
    val error: Message? = null,
) {
    /**
     * Enough typed to be worth sending. Not validation: the station decides, and it is the only one
     * that can.
     *
     * The code is the one exception, and it is arithmetic rather than judgement — the station's own
     * contract will not accept fewer than six digits, so sending three spends an attempt against
     * the sign-in rate limit to be told something that was knowable here.
     */
    val canSubmit: Boolean
        get() =
            when {
                busy -> false
                challenge != null -> code.length >= CODE_LENGTH
                else -> email.isNotBlank() && password.isNotEmpty()
            }

    companion object {
        /** The shortest code the station's contract will take. */
        const val CODE_LENGTH = 6

        /** Typing again clears the last answer: what failed is no longer what is in the fields. */
        fun typingEmail(current: AccountState, email: String): AccountState = current.copy(email = email, error = null)

        fun typingPassword(current: AccountState, password: String): AccountState = current.copy(password = password, error = null)

        fun typingCode(current: AccountState, code: String): AccountState = current.copy(code = code, error = null)

        /**
         * Back to the password step, keeping the email.
         *
         * For somebody who cannot reach their authenticator, and for every outcome that leaves
         * nothing to answer — an expired challenge and a refused factor both end the round rather
         * than inviting another code that cannot work.
         */
        fun startAgain(current: AccountState): AccountState = AccountState(email = current.email)

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

                is SignInResult.SecondFactorNeeded -> {
                    // The AUTHENTICATOR out of the challenge, never its first entry: a challenge
                    // lists every enrolled factor in enrolment order, and this app can answer only
                    // the one a code box fits.
                    val factor = authenticatorFactors(result.factors).firstOrNull()
                    if (factor == null) {
                        // Saying so beats a code box that would refuse every code.
                        current.copy(password = "", busy = false, error = Message.SecondFactorUnsupported)
                    } else {
                        // The password step is done, so the password goes; the email stays, because
                        // it is shown above the code box as whose sign-in this is.
                        current.copy(
                            password = "",
                            code = "",
                            challenge = SecondFactor(result.challengeId, factor.methodId),
                            busy = false,
                            error = null,
                        )
                    }
                }

                // Which field was wrong depends on which step asked. On the code step the email and
                // password were accepted a moment ago, and saying they were not sends somebody to
                // check the one thing that is already known to be right.
                SignInResult.BadCredentials ->
                    if (current.challenge == null) {
                        current.copy(password = "", busy = false, error = Message.BadCredentials)
                    } else {
                        current.copy(code = "", busy = false, error = Message.CodeRefused)
                    }

                // Neither of these can be answered by trying harder, so the code box goes away
                // rather than inviting another attempt that cannot work.
                SignInResult.ChallengeExpired -> startAgain(current).copy(error = Message.SignInExpired)
                SignInResult.FactorRefused -> startAgain(current).copy(error = Message.FactorRefused)

                SignInResult.NoRefreshToken -> current.copy(busy = false, error = Message.NoRefreshToken)

                is SignInResult.Failed ->
                    current.copy(
                        busy = false,
                        // The station's own words are not shown. They are an HTTP message or an
                        // exception, written for whoever wrote the station rather than for whoever
                        // is holding the phone, and neither tells a listener what to do next.
                        error = Message.CouldNotReachToSignIn,
                    )
            }
    }
}
