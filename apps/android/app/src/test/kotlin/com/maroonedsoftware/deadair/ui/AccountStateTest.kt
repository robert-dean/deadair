package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.auth.CodeSendResult
import com.maroonedsoftware.deadair.auth.ResetResult
import com.maroonedsoftware.deadair.auth.SignInResult
import com.maroonedsoftware.deadair.sdk.models.AuthenticationFactorKind
import com.maroonedsoftware.deadair.sdk.models.AuthenticationFactorMethod
import com.maroonedsoftware.deadair.sdk.models.MfaChallengeFactor
import com.maroonedsoftware.deadair.ui.settings.AccountState
import com.maroonedsoftware.deadair.ui.settings.SecondFactor
import com.maroonedsoftware.deadair.ui.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the sign-in fields say, and what they keep.
 *
 * The wording is the part most likely to be wrong and the part hardest to check by looking at a
 * screenshot, which is why it is decided by a function rather than inside a composable.
 */
class AccountStateTest {
    private val typed = AccountState(email = "operator@example.com", password = "hunter2", busy = true)

    @Test
    fun `will not submit until both fields have something in them`() {
        assertFalse(AccountState().canSubmit)
        assertFalse(AccountState(email = "operator@example.com").canSubmit)
        assertFalse(AccountState(password = "hunter2").canSubmit)
        assertTrue(AccountState(email = "operator@example.com", password = "hunter2").canSubmit)
    }

    @Test
    fun `will not submit twice while the station is answering`() {
        assertFalse(AccountState(email = "operator@example.com", password = "hunter2", busy = true).canSubmit)
    }

    @Test
    fun `typing again clears the last answer`() {
        val refused = AccountState(email = "operator@example.com", error = Message.BadCredentials)

        assertNull(AccountState.typingEmail(refused, "someone@example.com").error)
        assertNull(AccountState.typingPassword(refused, "h").error)
    }

    @Test
    fun `signing in empties the fields, password included`() {
        assertEquals(AccountState(), AccountState.from(typed, SignInResult.Ok))
    }

    @Test
    fun `a refusal keeps the email and drops the password`() {
        val next = AccountState.from(typed, SignInResult.BadCredentials)

        // The password is the half that is probably wrong and is certainly the one worth retyping.
        assertEquals("operator@example.com", next.email)
        assertEquals("", next.password)
        assertFalse(next.busy)
        assertEquals(Message.BadCredentials, next.error)
    }

    @Test
    fun `an unreachable station keeps both, so nothing is retyped once it is back`() {
        val next = AccountState.from(typed, SignInResult.Failed("Connection refused"))

        assertEquals("operator@example.com", next.email)
        assertEquals("hunter2", next.password)
        assertFalse(next.busy)
    }

    @Test
    fun `does not show the listener the station's own words`() {
        // An HTTP message or an exception is written for whoever wrote the station, not for
        // whoever is holding the phone, and it does not say what to do next.
        val next = AccountState.from(typed, SignInResult.Failed("java.net.SocketTimeoutException: timeout"))

        assertEquals(Message.CouldNotReachToSignIn, next.error)
    }

    @Test
    fun `names what the station asked for that this app cannot do`() {
        assertEquals(Message.NoRefreshToken, AccountState.from(typed, SignInResult.NoRefreshToken).error)
    }

    // ── The second factor ──────────────────────────────────────────────────────

    private fun factor(method: AuthenticationFactorMethod, methodId: String) =
        MfaChallengeFactor(method = method, methodId = methodId, kind = AuthenticationFactorKind.POSSESSION)

    @Test
    fun `a challenge moves to the code step and drops the password`() {
        val next = AccountState.from(typed, SignInResult.SecondFactorNeeded("c_1", listOf(factor(AuthenticationFactorMethod.AUTHENTICATOR, "totp-1"))))

        assertEquals(SecondFactor.Authenticator("c_1", "totp-1"), next.challenge)
        assertEquals("operator@example.com", next.email)
        assertEquals("", next.password)
        assertFalse(next.busy)
        // Not an error: the password was accepted, and the round is still going.
        assertNull(next.error)
    }

    @Test
    fun `the code goes against the authenticator, not whichever factor is listed first`() {
        // A challenge lists every enrolled factor in ENROLMENT order, so an email factor enrolled
        // first sits ahead of the authenticator. Sending the code against `email-1` is refused as
        // `invalid_factor`, which at the keyboard reads exactly like a mistyped code.
        val challenge =
            SignInResult.SecondFactorNeeded(
                "c_1",
                listOf(factor(AuthenticationFactorMethod.EMAIL, "email-1"), factor(AuthenticationFactorMethod.AUTHENTICATOR, "totp-1")),
            )

        // The email factor rides along as the way out for somebody without their authenticator.
        assertEquals(SecondFactor.Authenticator("c_1", "totp-1", SecondFactor.Email("c_1")), AccountState.from(typed, challenge).challenge)
    }

    @Test
    fun `says so when the account's second factor is not one this app can answer`() {
        // Better than a code box that would refuse every code. A passkey needs a WebAuthn assertion.
        val challenge = SignInResult.SecondFactorNeeded("c_1", listOf(factor(AuthenticationFactorMethod.FIDO, "fido-1")))

        val next = AccountState.from(typed, challenge)

        assertNull(next.challenge)
        assertEquals(Message.SecondFactorUnsupported, next.error)
    }

    @Test
    fun `an account with email and a passkey is sent a code rather than refused`() {
        // The account that reported this: an email factor and a passkey, and no authenticator.
        val challenge =
            SignInResult.SecondFactorNeeded(
                "c_1",
                listOf(
                    MfaChallengeFactor(AuthenticationFactorMethod.EMAIL, "email-1", AuthenticationFactorKind.POSSESSION, label = "o•••@example.com"),
                    factor(AuthenticationFactorMethod.FIDO, "fido-1"),
                ),
            )

        val next = AccountState.from(typed, challenge)

        assertEquals(SecondFactor.Email("c_1", sentTo = "o•••@example.com"), next.challenge)
        assertNull(next.error)
        assertEquals("", next.password)
        // Busy until the station says it sent one, and the view model sends it because of that.
        assertTrue(AccountState.needsCodeSent(next))
        assertFalse(next.copy(code = "123456").canSubmit)
    }

    @Test
    fun `a sent code gives the box something to answer`() {
        val sending = AccountState(email = "operator@example.com", challenge = SecondFactor.Email("c_1"), busy = true)

        val next = AccountState.fromCodeSent(sending, CodeSendResult.Sent("e_1"))

        assertEquals(SecondFactor.Email("c_1", emailChallengeId = "e_1"), next.challenge)
        assertFalse(next.busy)
        assertFalse(AccountState.needsCodeSent(next))
        assertTrue(next.copy(code = "123456").canSubmit)
    }

    @Test
    fun `a send that cannot happen says why, and an expired one ends the round`() {
        val sending = AccountState(email = "operator@example.com", challenge = SecondFactor.Email("c_1"), busy = true)

        assertEquals(Message.CodeNoMail, AccountState.fromCodeSent(sending, CodeSendResult.NoMail).error)
        assertEquals(Message.CouldNotSendCode, AccountState.fromCodeSent(sending, CodeSendResult.Failed("boom")).error)
        val expired = AccountState.fromCodeSent(sending, CodeSendResult.ChallengeExpired)
        assertNull(expired.challenge)
        assertEquals(Message.SignInExpired, expired.error)
        assertEquals("operator@example.com", expired.email)
    }

    @Test
    fun `a refused emailed code says to check the email rather than wait`() {
        val challenged = AccountState(email = "operator@example.com", code = "000000", challenge = SecondFactor.Email("c_1", emailChallengeId = "e_1"), busy = true)

        val next = AccountState.from(challenged, SignInResult.BadCredentials)

        assertEquals(Message.EmailedCodeRefused, next.error)
        assertEquals(challenged.challenge, next.challenge)
        assertEquals("", next.code)
    }

    @Test
    fun `choosing email keeps the challenge and asks for a send`() {
        val email = SecondFactor.Email("c_1")
        val challenged = AccountState(email = "operator@example.com", code = "12", challenge = SecondFactor.Authenticator("c_1", "totp-1", email))

        val next = AccountState.usingEmail(challenged)

        assertEquals(email, next.challenge)
        assertEquals("", next.code)
        assertTrue(AccountState.needsCodeSent(next))
        // Without an email factor there is nothing to switch to.
        val alone = AccountState(email = "operator@example.com", challenge = SecondFactor.Authenticator("c_1", "totp-1"))
        assertEquals(alone, AccountState.usingEmail(alone))
    }

    @Test
    fun `sending again waits for the new send before taking a code`() {
        val sent = AccountState(email = "operator@example.com", code = "123456", challenge = SecondFactor.Email("c_1", emailChallengeId = "e_1"))

        val again = AccountState.sendingAgain(sent)

        assertTrue(AccountState.needsCodeSent(again))
        assertFalse(again.canSubmit)
        // Not twice while the station is answering.
        assertEquals(again, AccountState.sendingAgain(again))
    }

    @Test
    fun `will not send a code shorter than the station will take`() {
        val challenged = AccountState(email = "operator@example.com", challenge = SecondFactor.Authenticator("c_1", "totp-1"))

        assertFalse(challenged.copy(code = "123").canSubmit)
        assertTrue(challenged.copy(code = "123456").canSubmit)
        assertFalse(challenged.copy(code = "123456", busy = true).canSubmit)
    }

    @Test
    fun `a refused code is not a refused password`() {
        // On the code step the email and password were accepted a moment ago, and saying they were
        // not sends somebody to check the one thing already known to be right.
        val challenged = AccountState(email = "operator@example.com", code = "000000", challenge = SecondFactor.Authenticator("c_1", "totp-1"), busy = true)

        val next = AccountState.from(challenged, SignInResult.BadCredentials)

        assertEquals(Message.CodeRefused, next.error)
        assertEquals("", next.code)
        // Still on the code step: another code from the same authenticator will work.
        assertEquals(SecondFactor.Authenticator("c_1", "totp-1"), next.challenge)
    }

    @Test
    fun `an expired challenge and a refused factor both end the round`() {
        val challenged = AccountState(email = "operator@example.com", code = "123456", challenge = SecondFactor.Authenticator("c_1", "totp-1"), busy = true)

        // Neither can be answered by trying harder, so the code box goes away rather than inviting
        // another attempt that cannot work.
        val expired = AccountState.from(challenged, SignInResult.ChallengeExpired)
        assertNull(expired.challenge)
        assertEquals("", expired.code)
        assertEquals("operator@example.com", expired.email)
        assertEquals(Message.SignInExpired, expired.error)

        val refused = AccountState.from(challenged, SignInResult.FactorRefused)
        assertNull(refused.challenge)
        assertEquals(Message.FactorRefused, refused.error)
    }

    @Test
    fun `starting again keeps the email and nothing else`() {
        val challenged = AccountState(email = "operator@example.com", code = "123456", challenge = SecondFactor.Authenticator("c_1", "totp-1"))

        assertEquals(AccountState(email = "operator@example.com"), AccountState.startAgain(challenged))
    }

    // ── A forgotten password ────────────────────────────────────────────────────────────

    @Test
    fun `a reset needs only the address, and says so when there is none`() {
        assertEquals(Message.ResetNeedsEmail, AccountState.askingReset(AccountState()).error)
        assertFalse(AccountState.askingReset(AccountState()).busy)

        val asking = AccountState.askingReset(AccountState(email = "operator@example.com"))
        assertTrue(asking.busy)
        assertNull(asking.error)
    }

    @Test
    fun `a reset is not asked twice while the station is answering`() {
        val busy = AccountState(email = "operator@example.com", busy = true)

        assertEquals(busy, AccountState.askingReset(busy))
    }

    @Test
    fun `a sent link leaves the form for the inbox, keeping the address for coming back`() {
        val sent = AccountState.fromReset(AccountState(email = " operator@example.com ", password = "half typed", busy = true), ResetResult.Sent)

        assertEquals("operator@example.com", sent.resetSentTo)
        assertEquals(" operator@example.com ", sent.email)
        assertEquals("", sent.password)
        assertFalse(sent.busy)
        assertEquals(AccountState(email = " operator@example.com "), AccountState.startAgain(sent))
    }

    @Test
    fun `a refused reset says why and keeps what was typed`() {
        val asking = AccountState(email = "operator@example.com", password = "x", busy = true)

        assertEquals(Message.ResetNotAnAddress, AccountState.fromReset(asking, ResetResult.NotAnAddress).error)
        assertEquals(Message.ResetTooMany, AccountState.fromReset(asking, ResetResult.TooMany).error)
        assertEquals(Message.ResetNoMail, AccountState.fromReset(asking, ResetResult.NoMail).error)
        val failed = AccountState.fromReset(asking, ResetResult.Failed("timeout"))
        assertEquals(Message.CouldNotReachToReset, failed.error)
        assertEquals("x", failed.password)
        assertFalse(failed.busy)
        assertNull(failed.resetSentTo)
    }
}
