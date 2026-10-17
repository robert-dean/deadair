package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.models.AuthenticationFactorMethod
import com.maroonedsoftware.deadair.sdk.models.MfaChallengeFactor

/**
 * Which of a challenge's factors this app can answer with an authenticator code.
 *
 * A challenge lists every factor the account has enrolled, in ENROLMENT order, so the first entry
 * is not reliably the one a code box can satisfy — an email factor enrolled first sits ahead of the
 * authenticator. The station refuses a code sent with another factor's method id as
 * `invalid_factor`, which at the keyboard reads exactly like a mistyped code. The desktop app was
 * shipped sending `factors.first()` and the report that came back was "the 2FA code is not
 * accepted", which is the one explanation that had already been ruled out.
 */
fun authenticatorFactors(factors: List<MfaChallengeFactor>): List<MfaChallengeFactor> =
    factors.filter { it.method == AuthenticationFactorMethod.AUTHENTICATOR }

/**
 * The challenge's email factor, if it has one: the other factor this app can answer.
 *
 * An emailed code needs a challenge started against it first (`POST /auth/factors/start`), which is
 * what sends the message. Accounts made with an email and a passkey and nothing else were refused
 * here outright until this existed, because the passkey is the one factor left over: FIDO needs a
 * WebAuthn assertion this app has no way to produce, and that stays the console's job.
 */
fun emailFactor(factors: List<MfaChallengeFactor>): MfaChallengeFactor? = factors.firstOrNull { it.method == AuthenticationFactorMethod.EMAIL }
