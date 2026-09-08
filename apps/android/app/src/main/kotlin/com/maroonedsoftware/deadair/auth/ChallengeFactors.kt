package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.models.AuthenticationFactorMethod
import com.maroonedsoftware.deadair.sdk.models.MfaChallengeFactor

/**
 * Which of a challenge's factors this app can actually answer: the AUTHENTICATOR, and only that.
 *
 * A challenge lists every factor the account has enrolled, in ENROLMENT order, so the first entry
 * is not reliably the one a code box can satisfy — an email factor enrolled first sits ahead of the
 * authenticator. The station refuses a code sent with another factor's method id as
 * `invalid_factor`, which at the keyboard reads exactly like a mistyped code. The desktop app was
 * shipped sending `factors.first()` and the report that came back was "the 2FA code is not
 * accepted", which is the one explanation that had already been ruled out.
 *
 * The others are not oversights. A phone or email factor needs a challenge started against it first
 * (`POST /auth/factors/start`), and FIDO needs a WebAuthn assertion this app has no way to produce;
 * both are the console's job. Answering with an empty list is what lets the screen SAY that rather
 * than draw a code box no code could ever satisfy.
 */
fun authenticatorFactors(factors: List<MfaChallengeFactor>): List<MfaChallengeFactor> =
    factors.filter { it.method == AuthenticationFactorMethod.AUTHENTICATOR }
