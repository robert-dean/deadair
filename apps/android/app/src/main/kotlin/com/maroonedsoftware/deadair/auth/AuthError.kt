package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.runtime.SdkError
import io.ktor.http.HttpHeaders
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

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

/**
 * Whether a refusal is asking for a second factor rather than saying no.
 *
 * Two spellings of the same thing and both are read, because the station sends both and neither is
 * guaranteed to survive the trip: `details.kind` is the policy's own rendering, and the
 * `WWW-Authenticate` challenge is the copy it exposes through CORS for a browser's benefit.
 *
 * Told apart from a plain 403 because they are opposite states. A plain one means the account does
 * not hold the permission and retrying is pointless; this one means it does, and the station wants
 * the account proved again first. Reading them as one is what makes an app tell an operator they
 * are no longer the operator when they are.
 */
fun namesStepUp(body: JsonElement?, challenges: List<String>): Boolean {
    val kind = ((body as? JsonObject)?.get("details") as? JsonObject)?.get("kind") as? JsonPrimitive
    return kind?.content == STEP_UP_REQUIRED || authErrorIn(challenges) == MFA_REQUIRED
}

/** Whether this refusal wants a second factor. False for every status but 403. */
val SdkError.isStepUpRequired: Boolean
    get() = status == FORBIDDEN && namesStepUp(json, response.headers.getAll(HttpHeaders.WWWAuthenticate).orEmpty())

/** How the policy renders the denial in the body it sends everybody. */
private const val STEP_UP_REQUIRED = "step_up_required"

private const val FORBIDDEN = 403
