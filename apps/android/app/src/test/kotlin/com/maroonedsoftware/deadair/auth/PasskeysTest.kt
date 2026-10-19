package com.maroonedsoftware.deadair.auth

import com.maroonedsoftware.deadair.sdk.models.FidoPublicKeyCredentialRequestOptions
import com.maroonedsoftware.deadair.sdk.models.FidoPublicKeyCredentialRequestOptionsUserVerification
import com.maroonedsoftware.deadair.sdk.models.PublicKeyCredentialAuthenticatorAttachment
import com.maroonedsoftware.deadair.sdk.models.PublicKeyCredentialDescriptor
import com.maroonedsoftware.deadair.sdk.models.PublicKeyCredentialDescriptorTransports
import java.security.MessageDigest
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The plain-data halves of a passkey. The station and Credential Manager spell the same bytes in
 * two alphabets, and a challenge in the wrong one is refused by the prompt before anybody is asked.
 */
class PasskeysTest {
    @Test
    fun `the app's origin is the base64url SHA-256 of its certificate, as Credential Manager writes it`() {
        val certificate = "a certificate".toByteArray()
        val hash = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(certificate))

        assertEquals("android:apk-key-hash:$hash", appOrigin(certificate))
        assertFalse(appOrigin(certificate).contains('='))
    }

    @Test
    fun `the request turns the station's base64 into base64url, and keeps what it names`() {
        val request =
            Json.parseToJsonElement(
                    passkeyRequestJson(
                        FidoPublicKeyCredentialRequestOptions(
                            challenge = "ab+c/d==",
                            timeout = 300_000,
                            rpId = "radio.example.com",
                            userVerification = FidoPublicKeyCredentialRequestOptionsUserVerification.PREFERRED,
                            allowCredentials =
                                listOf(PublicKeyCredentialDescriptor(id = "Y3+/ZA==", transports = listOf(PublicKeyCredentialDescriptorTransports.INTERNAL))),
                        ),
                    ),
                )
                .jsonObject

        assertEquals("ab-c_d", request["challenge"]?.jsonPrimitive?.content)
        assertEquals("radio.example.com", request["rpId"]?.jsonPrimitive?.content)
        assertEquals("300000", request["timeout"]?.jsonPrimitive?.content)
        assertEquals("preferred", request["userVerification"]?.jsonPrimitive?.content)
        val allowed = request["allowCredentials"]!!.jsonArray.single().jsonObject
        assertEquals("Y3-_ZA", allowed["id"]?.jsonPrimitive?.content)
        assertEquals("public-key", allowed["type"]?.jsonPrimitive?.content)
        assertEquals("internal", allowed["transports"]!!.jsonArray.single().jsonPrimitive.content)
    }

    @Test
    fun `a request with nothing optional names only the challenge`() {
        val request = Json.parseToJsonElement(passkeyRequestJson(FidoPublicKeyCredentialRequestOptions(challenge = "abc"))).jsonObject

        assertEquals(setOf("challenge"), request.keys)
    }

    @Test
    fun `the answer reads as the station's credential, with empty extension results when there were none`() {
        val credential =
            passkeyCredential(
                """{"id":"cred","rawId":"cred","type":"public-key","authenticatorAttachment":"platform",""" +
                    """"response":{"clientDataJSON":"cd","authenticatorData":"ad","signature":"sig","userHandle":"uh"},"somethingNew":1}""",
            )

        assertEquals("cred", credential.id)
        assertEquals(PublicKeyCredentialAuthenticatorAttachment.PLATFORM, credential.authenticatorAttachment)
        assertEquals("cd", credential.response.clientDataJson)
        assertEquals("sig", credential.response.signature)
        assertEquals("uh", credential.response.userHandle)
        assertNull(credential.clientExtensionResults.appid)
    }
}
