package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import io.ktor.http.HttpHeaders

/**
 * The station's own name for what went wrong, out of `WWW-Authenticate`.
 *
 * The token endpoint refuses several different things with the same 401, and the status alone
 * cannot tell them apart: `invalid_grant` is a wrong code, `invalid_challenge` is a sign-in that
 * has expired, and `invalid_factor` is a code sent against a factor the challenge does not list.
 * The remedies are "type it again", "start again" and "this app has a bug", so collapsing them into
 * one sentence tells the operator the one thing that is not true.
 *
 * Parsed rather than matched whole, because the header is a challenge with parameters
 * (`Bearer error="invalid_factor", error_description="..."`) and the station is free to add more of
 * them. Anything that is not a challenge carrying an `error` reads as no answer at all.
 */
fun authErrorIn(challenges: List<String>): String? = challenges.firstNotNullOfOrNull { ERROR_PARAMETER.find(it)?.groupValues?.get(1) }

/** What the station named in `WWW-Authenticate`, or `null` when it sent none. */
val SdkError.authError: String?
    get() = authErrorIn(response.headers.getAll(HttpHeaders.WWWAuthenticate).orEmpty())

/** `error="..."`, wherever it sits among the challenge's parameters. */
private val ERROR_PARAMETER = Regex("""error="([^"]*)"""")

/** The station has forgotten the challenge: it expired, or it was already spent. */
const val INVALID_CHALLENGE = "invalid_challenge"

/** The factor the code was sent against is not one the challenge lists. Always a client bug. */
const val INVALID_FACTOR = "invalid_factor"

/** The 403 that is asking for a second factor rather than refusing outright. */
const val MFA_REQUIRED = "mfa_required"
