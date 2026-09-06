package com.maroonedsoftware.deadair.ui

import com.maroonedsoftware.deadair.auth.SignInResult
import com.maroonedsoftware.deadair.ui.settings.AccountState
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
        val refused = AccountState(email = "operator@example.com", error = "That email and password did not work")

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
        assertEquals("That email and password did not work", next.error)
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

        assertEquals("Could not reach the station to sign in", next.error)
    }
}
