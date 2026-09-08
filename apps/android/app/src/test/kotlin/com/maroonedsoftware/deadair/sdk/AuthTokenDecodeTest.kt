package com.maroonedsoftware.deadair.sdk

import com.maroonedsoftware.deadair.sdk.models.AuthenticationTokenIssued
import com.maroonedsoftware.deadair.sdk.models.AuthenticationTokenResponse
import com.maroonedsoftware.deadair.sdk.runtime.SdkJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * That the generated SDK decodes the token the station actually issues.
 *
 * This is the test that would have caught the third generator bug, and it is worth saying what that
 * bug looked like from here. `authentication.types.ck` declares these contracts
 * `format(output=snake)`, so the station sends `access_token` while the contract calls the field
 * `accessToken` — and the Kotlin generator dropped that rename entirely, emitting a camelCase
 * property with no `@SerialName`. The output compiled perfectly. It failed at DECODE, on a phone,
 * with a `MissingFieldException` naming three fields and saying nothing about the casing that
 * renamed them.
 *
 * A compile cannot see this class of bug, which is why the fixtures below are the literal bodies
 * `/auth/token` answers with rather than anything shaped by what the models happen to want. Fixed
 * upstream in `@contractkit/plugin-kotlin` 0.1.2, which is the floor this repo now pins.
 */
class AuthTokenDecodeTest {
    @Test
    fun `decodes the token a password grant is answered with`() {
        val json =
            """
            {
              "result": "token",
              "access_token": "eyJhbGciOiJIUzI1NiJ9.header.signature",
              "refresh_token": "0f8c1e9a-0000-4000-8000-000000000001",
              "expires_in": 2592000,
              "token_type": "Bearer",
              "scope": "platform"
            }
            """.trimIndent()

        val answer = SdkJson.decodeFromString(AuthenticationTokenResponse.serializer(), json)

        assertTrue(answer is AuthenticationTokenIssued)
        val issued = answer as AuthenticationTokenIssued
        assertEquals("eyJhbGciOiJIUzI1NiJ9.header.signature", issued.accessToken)
        assertEquals("0f8c1e9a-0000-4000-8000-000000000001", issued.refreshToken)
        assertEquals(2_592_000L, issued.expiresIn)
        assertEquals("Bearer", issued.tokenType)
        assertEquals("platform", issued.scope)
    }

    @Test
    fun `decodes a rotation, which is the same shape by a different route`() {
        // A refresh answers with a fresh pair, and the refresh token is single-use: reading the new
        // one back correctly is what stops the next refresh replaying a spent token, which the
        // station treats as theft and answers by revoking the whole family.
        val json =
            """
            {
              "result": "token",
              "access_token": "second-access",
              "refresh_token": "second-refresh",
              "expires_in": 2592000,
              "token_type": "Bearer",
              "scope": "platform"
            }
            """.trimIndent()

        val issued = SdkJson.decodeFromString(AuthenticationTokenResponse.serializer(), json) as AuthenticationTokenIssued

        assertEquals("second-access", issued.accessToken)
        assertEquals("second-refresh", issued.refreshToken)
    }

    @Test
    fun `decodes a token issued without a refresh half`() {
        // The one optional field of the six. A browser gets its refresh token in an httpOnly cookie
        // instead, and this app deliberately does not ask for that — but the shape is still legal.
        val json =
            """
            {
              "result": "token",
              "access_token": "only-access",
              "expires_in": 2592000,
              "token_type": "Bearer",
              "scope": "platform"
            }
            """.trimIndent()

        val issued = SdkJson.decodeFromString(AuthenticationTokenResponse.serializer(), json) as AuthenticationTokenIssued

        assertEquals("only-access", issued.accessToken)
        assertNull(issued.refreshToken)
    }
}
