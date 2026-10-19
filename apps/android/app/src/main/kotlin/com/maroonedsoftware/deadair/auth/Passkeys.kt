package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.models.FidoPublicKeyCredentialRequestOptions
import com.maroonedsoftware.deadair.sdk.models.FidoPublicKeyCredentialRequestOptionsUserVerification
import com.maroonedsoftware.deadair.sdk.models.PublicKeyCredentialDescriptorTransports
import com.maroonedsoftware.deadair.sdk.models.PublicKeyCredentialWithAssertion
import com.maroonedsoftware.deadair.sdk.runtime.SdkJson
import java.security.MessageDigest
import java.util.Base64
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/**
 * The two halves of a passkey that are plain data: what Credential Manager is asked, and what it
 * answers, as the station speaks them. No `android.*`, so both are JVM-tested; the prompt itself is
 * `PasskeyPrompt.kt`.
 *
 * The station and Credential Manager disagree about one thing. The station sends the challenge and
 * each credential id as STANDARD base64 (`+`, `/`, `=`); Credential Manager takes the WebAuthn JSON
 * form, which is base64url without padding, and refuses the other. The answer comes back base64url,
 * which the station decodes as it does the browser's.
 */

/** The header the station reads this app's WebAuthn origin from; the API's `APP_ORIGIN_HEADER`. */
const val APP_ORIGIN_HEADER = "x-deadair-app-origin"

/**
 * This app's WebAuthn origin, as Credential Manager writes it into every assertion's
 * `clientDataJSON`: `android:apk-key-hash:` and the base64url SHA-256 of the signing certificate.
 */
fun appOrigin(signingCertificate: ByteArray): String =
    "android:apk-key-hash:" + Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(signingCertificate))

/** Base64 of either alphabet, padded or not, as base64url without padding. */
internal fun toBase64Url(value: String): String = value.replace('+', '-').replace('/', '_').trimEnd('=')

/** The station's assertion options as the `requestJson` a `GetPublicKeyCredentialOption` takes. */
fun passkeyRequestJson(options: FidoPublicKeyCredentialRequestOptions): String =
    buildJsonObject {
            put("challenge", toBase64Url(options.challenge))
            options.rpId?.let { put("rpId", it) }
            options.timeout?.let { put("timeout", it) }
            options.userVerification
                ?.takeUnless { it == FidoPublicKeyCredentialRequestOptionsUserVerification.UNKNOWN }
                ?.let { put("userVerification", it.name.lowercase()) }
            options.allowCredentials?.let { allowed ->
                putJsonArray("allowCredentials") {
                    for (credential in allowed) {
                        add(
                            buildJsonObject {
                                put("type", credential.type)
                                put("id", toBase64Url(credential.id))
                                credential.transports
                                    ?.filter { it != PublicKeyCredentialDescriptorTransports.UNKNOWN }
                                    ?.takeIf { it.isNotEmpty() }
                                    ?.let { transports -> put("transports", buildJsonArray { transports.forEach { add(it.name.lowercase()) } }) }
                            },
                        )
                    }
                }
            }
        }
        .toString()

/**
 * Credential Manager's `authenticationResponseJson` as the credential the `fido` grant posts.
 *
 * The field names are WebAuthn's and the SDK's alike. `clientExtensionResults` is the one the
 * station requires and a provider may leave out, so an absent one is sent as empty.
 */
fun passkeyCredential(authenticationResponseJson: String): PublicKeyCredentialWithAssertion {
    val answer = SdkJson.parseToJsonElement(authenticationResponseJson).jsonObject
    val complete = if ("clientExtensionResults" in answer) answer else JsonObject(answer + ("clientExtensionResults" to JsonObject(emptyMap())))
    return SdkJson.decodeFromJsonElement(PublicKeyCredentialWithAssertion.serializer(), complete)
}

/** What came of asking the station to start a passkey assertion for a pending challenge. */
sealed interface PasskeyStartResult {
    /** [requestJson] is what Credential Manager is asked; [fidoChallengeId] is echoed back on the grant. */
    data class Started(val fidoChallengeId: String, val requestJson: String) : PasskeyStartResult

    /** The pending sign-in expired first. */
    data object ChallengeExpired : PasskeyStartResult

    /**
     * The station will not start one for this app: it is not published over https, so Android has
     * nowhere to look the app up, or it does not vouch for this build's signing certificate.
     */
    data object NotOffered : PasskeyStartResult

    data class Failed(val message: String?) : PasskeyStartResult
}

/** What the passkey prompt answered. */
sealed interface PasskeyAnswer {
    data class Answered(val authenticationResponseJson: String) : PasskeyAnswer

    /** The person closed the prompt, which is a choice rather than a fault. */
    data object Cancelled : PasskeyAnswer

    /** Nothing on this phone holds a passkey for the station. */
    data object NoPasskey : PasskeyAnswer

    /** Anything else Credential Manager refused with. Carries its type, which is never shown. */
    data class Failed(val message: String?) : PasskeyAnswer
}
