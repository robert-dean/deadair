package com.maroonedsoftware.deadair.ui.settings

import com.maroonedsoftware.deadair.auth.CodeSendResult
import com.maroonedsoftware.deadair.auth.PasskeyAnswer
import com.maroonedsoftware.deadair.auth.PasskeyStartResult
import com.maroonedsoftware.deadair.auth.ResetResult
import com.maroonedsoftware.deadair.auth.SignInResult
import com.maroonedsoftware.deadair.auth.authenticatorFactors
import com.maroonedsoftware.deadair.auth.emailFactor
import com.maroonedsoftware.deadair.auth.passkeyFactor
import com.maroonedsoftware.deadair.ui.text.Message

/**
 * The challenge a code is being typed against, and where the code comes from.
 *
 * Every arm carries the challenge, which says which pending sign-in this is. What else it needs
 * depends on the factor, because the station binds the two kinds of code differently.
 */
sealed interface SecondFactor {
    val challengeId: String

    /**
     * A code from an authenticator app. The method id says which enrolled authenticator the six
     * digits are supposed to be from: TOTP has no other binding to the actor at initial login, so a
     * code sent without the right method id is refused — and refused in a way that reads at the
     * keyboard exactly like a wrong code.
     *
     * [email] is set when the account can also be sent a code, for somebody whose authenticator is
     * on a phone they do not have with them, and [passkey] when it has a passkey.
     */
    data class Authenticator(override val challengeId: String, val methodId: String, val email: Email? = null, val passkey: Passkey? = null) :
        SecondFactor

    /**
     * A code the station emails. [emailChallengeId] is the message's id, which the code grant echoes
     * back, and is absent until the station has said it sent one: there is nothing to type before
     * that. [sentTo] is the station's label for the address, usually masked, when it gave one.
     */
    data class Email(override val challengeId: String, val sentTo: String? = null, val emailChallengeId: String? = null) : SecondFactor

    /**
     * A passkey, answered through Credential Manager rather than typed. Three exchanges rather than
     * one, and [step] says which is due: the station starts an assertion, the phone asks the person
     * for their passkey, and the station checks what the phone signed. [fidoChallengeId] and
     * [requestJson] are the started assertion, absent until the station has answered.
     *
     * [email] is set when the account can also be sent a code, for a phone with no passkey on it.
     */
    data class Passkey(
        override val challengeId: String,
        val email: Email? = null,
        val step: PasskeyStep = PasskeyStep.STARTING,
        val fidoChallengeId: String? = null,
        val requestJson: String? = null,
    ) : SecondFactor
}

/** Which of a passkey's three exchanges is next, while the sign-in is busy. */
enum class PasskeyStep {
    /** Asking the station to start an assertion. */
    STARTING,

    /** The phone's passkey prompt is up. */
    ASKING,

    /** The station is checking the signed assertion. */
    CHECKING,
}

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
    /**
     * The address a password-reset link was asked for, once the station has answered. Set, the
     * screen says to check that inbox instead of drawing the form.
     */
    val resetSentTo: String? = null,
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
                // Nothing to type: the button asks for the passkey again.
                challenge is SecondFactor.Passkey -> true
                challenge is SecondFactor.Email && challenge.emailChallengeId == null -> false
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

        /** Whether the screen is waiting on an email code to be sent, which the view model then asks for. */
        fun needsCodeSent(state: AccountState): Boolean {
            val challenge = state.challenge
            return state.busy && challenge is SecondFactor.Email && challenge.emailChallengeId == null
        }

        /**
         * "Email me a code instead", from the authenticator or the passkey step. Busy, because the
         * send is next; the challenge stays the same one, so nothing about the password step is
         * repeated.
         */
        fun usingEmail(current: AccountState): AccountState {
            if (current.busy) return current
            val email =
                when (val challenge = current.challenge) {
                    is SecondFactor.Authenticator -> challenge.email
                    is SecondFactor.Passkey -> challenge.email
                    else -> null
                } ?: return current
            return current.copy(code = "", challenge = email, busy = true, error = null)
        }

        /** "Use a passkey instead", from the authenticator step. Busy, because the station starts one next. */
        fun usingPasskey(current: AccountState): AccountState {
            val challenge = current.challenge
            if (current.busy || challenge !is SecondFactor.Authenticator) return current
            val passkey = challenge.passkey ?: return current
            return current.copy(code = "", challenge = passkey, busy = true, error = null)
        }

        /**
         * "Use your passkey", once a prompt was closed or refused: start the assertion again. The
         * station hands back the one it started while it is still live, so this costs nothing.
         */
        fun askingPasskeyAgain(current: AccountState): AccountState {
            val challenge = current.challenge
            if (current.busy || challenge !is SecondFactor.Passkey) return current
            return current.copy(challenge = challenge.copy(step = PasskeyStep.STARTING, fidoChallengeId = null, requestJson = null), busy = true, error = null)
        }

        /** Whether the station is to be asked to start a passkey assertion, which the view model then does. */
        fun needsPasskeyStarted(state: AccountState): Boolean {
            val challenge = state.challenge
            return state.busy && challenge is SecondFactor.Passkey && challenge.step == PasskeyStep.STARTING
        }

        /** Whether the passkey prompt is due, which the screen raises because it needs the activity. */
        fun passkeyPromptDue(state: AccountState): Boolean {
            val challenge = state.challenge
            return state.busy && challenge is SecondFactor.Passkey && challenge.step == PasskeyStep.ASKING && challenge.requestJson != null
        }

        /** What the passkey step shows once the station has answered a start. */
        fun fromPasskeyStarted(current: AccountState, result: PasskeyStartResult): AccountState {
            val challenge = current.challenge as? SecondFactor.Passkey ?: return current.copy(busy = false)
            return when (result) {
                is PasskeyStartResult.Started ->
                    current.copy(
                        challenge = challenge.copy(step = PasskeyStep.ASKING, fidoChallengeId = result.fidoChallengeId, requestJson = result.requestJson),
                        error = null,
                    )
                PasskeyStartResult.ChallengeExpired -> startAgain(current).copy(error = Message.SignInExpired)
                PasskeyStartResult.NotOffered -> current.copy(busy = false, error = Message.PasskeyNotOffered)
                is PasskeyStartResult.Failed -> current.copy(busy = false, error = Message.CouldNotStartPasskey)
            }
        }

        /**
         * What the passkey step shows once the prompt has answered. A signed assertion stays busy,
         * because the station checks it next; a closed prompt is a choice and says nothing.
         */
        fun fromPasskeyAnswer(current: AccountState, answer: PasskeyAnswer): AccountState {
            val challenge = current.challenge as? SecondFactor.Passkey ?: return current.copy(busy = false)
            return when (answer) {
                is PasskeyAnswer.Answered -> current.copy(challenge = challenge.copy(step = PasskeyStep.CHECKING), error = null)
                PasskeyAnswer.Cancelled -> current.copy(busy = false, error = null)
                PasskeyAnswer.NoPasskey -> current.copy(busy = false, error = Message.NoPasskeyOnPhone)
                is PasskeyAnswer.Failed -> current.copy(busy = false, error = Message.PasskeyFailed)
            }
        }

        /**
         * "Send it again": the same challenge, asked for once more. The message id is dropped until
         * the station answers, so nothing is submitted against a send that is still in flight.
         */
        fun sendingAgain(current: AccountState): AccountState {
            val challenge = current.challenge
            if (current.busy || challenge !is SecondFactor.Email) return current
            return current.copy(challenge = challenge.copy(emailChallengeId = null), busy = true, error = null)
        }

        /**
         * What the code step shows once the station has answered a send. Sent gives the box
         * something to type against; an expired challenge ends the round, as it does on the code.
         */
        fun fromCodeSent(current: AccountState, result: CodeSendResult): AccountState {
            val challenge = current.challenge as? SecondFactor.Email ?: return current.copy(busy = false)
            return when (result) {
                is CodeSendResult.Sent -> current.copy(challenge = challenge.copy(emailChallengeId = result.emailChallengeId), busy = false, error = null)
                CodeSendResult.ChallengeExpired -> startAgain(current).copy(error = Message.SignInExpired)
                CodeSendResult.NoMail -> current.copy(busy = false, error = Message.CodeNoMail)
                is CodeSendResult.Failed -> current.copy(busy = false, error = Message.CouldNotSendCode)
            }
        }

        /**
         * Asking for a password-reset link: busy, or told why not.
         *
         * Only the address is needed, the password being what this is instead of. With none typed
         * the answer is to type one, decided here rather than by sending a blank address to the
         * station to be told so.
         */
        fun askingReset(current: AccountState): AccountState =
            when {
                current.busy -> current
                current.email.isBlank() -> current.copy(error = Message.ResetNeedsEmail)
                else -> current.copy(busy = true, error = null)
            }

        /**
         * What the fields show once the station has answered a reset request. Sent leaves the form
         * for the check-your-inbox state, keeping the email for when they come back to sign in.
         */
        fun fromReset(current: AccountState, result: ResetResult): AccountState =
            when (result) {
                ResetResult.Sent -> AccountState(email = current.email, resetSentTo = current.email.trim())
                ResetResult.NotAnAddress -> current.copy(busy = false, error = Message.ResetNotAnAddress)
                ResetResult.TooMany -> current.copy(busy = false, error = Message.ResetTooMany)
                ResetResult.NoMail -> current.copy(busy = false, error = Message.ResetNoMail)
                is ResetResult.Failed -> current.copy(busy = false, error = Message.CouldNotReachToReset)
            }

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
                    // The AUTHENTICATOR out of the challenge first, never its first entry: a
                    // challenge lists every enrolled factor in enrolment order. An authenticator
                    // costs nothing to offer, where choosing email sends a message, so email leads
                    // only when there is no authenticator.
                    // A passkey comes before email for the same reason: a prompt on this phone costs
                    // nothing, and it is one touch.
                    val authenticator = authenticatorFactors(result.factors).firstOrNull()
                    val email = emailFactor(result.factors)?.let { SecondFactor.Email(result.challengeId, sentTo = it.label) }
                    val passkey = passkeyFactor(result.factors)?.let { SecondFactor.Passkey(result.challengeId, email) }
                    val challenge =
                        when {
                            authenticator != null -> SecondFactor.Authenticator(result.challengeId, authenticator.methodId, email, passkey)
                            passkey != null -> passkey
                            else -> email
                        }
                    if (challenge == null) {
                        // Saying so beats a code box that would refuse every code.
                        current.copy(password = "", busy = false, error = Message.SecondFactorUnsupported)
                    } else {
                        // The password step is done, so the password goes; the email stays, because
                        // it is shown above the code box as whose sign-in this is. An email factor
                        // stays busy, because the send that gives it something to type is next, and a
                        // passkey for the start that gives the prompt something to ask.
                        current.copy(
                            password = "",
                            code = "",
                            challenge = challenge,
                            busy = challenge is SecondFactor.Email || challenge is SecondFactor.Passkey,
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
                        // An authenticator's next code is half a minute away; an emailed one is
                        // the same code until it is sent again, so the advice differs.
                        val refused =
                            when (current.challenge) {
                                is SecondFactor.Email -> Message.EmailedCodeRefused
                                is SecondFactor.Passkey -> Message.PasskeyRefused
                                else -> Message.CodeRefused
                            }
                        current.copy(code = "", busy = false, error = refused)
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
