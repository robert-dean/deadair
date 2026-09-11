import DeadairSdk
import Foundation
import Testing

/// That the token endpoint's answers decode, in the station's own casing.
///
/// The contract carries `format(output=snake)`, so the station sends `access_token` against a
/// model property named `accessToken`. The Kotlin SDK's first real sign-in failed on exactly that,
/// with a message naming three missing fields and nothing about the casing; the C# SDK's first
/// fixture guessed the casing wrong. The fixtures are the literal bodies `/auth/token` answers with.
struct AuthTokenDecodeTests {
    private func decode(_ json: String) throws -> AuthenticationTokenResponse {
        try SdkJSON.makeDecoder().decode(AuthenticationTokenResponse.self, from: Data(json.utf8))
    }

    @Test func decodesTheTokenAPasswordGrantIsAnsweredWith() throws {
        let answer = try decode(
            #"{"result":"token","access_token":"eyJhbGciOiJIUzI1NiJ9.header.signature","refresh_token":"0f8c1e9a-0000-4000-8000-000000000001","expires_in":2592000,"token_type":"Bearer","scope":"platform"}"#
        )

        guard case .authenticationTokenIssued(let issued) = answer else {
            Issue.record("expected a token, got \(answer)")
            return
        }
        #expect(issued.accessToken == "eyJhbGciOiJIUzI1NiJ9.header.signature")
        #expect(issued.refreshToken == "0f8c1e9a-0000-4000-8000-000000000001")
        #expect(issued.expiresIn == 2_592_000)
        #expect(issued.tokenType == "Bearer")
        #expect(issued.scope == "platform")
    }

    @Test func decodesATokenIssuedWithoutARefreshHalf() throws {
        // A browser gets its refresh token in an httpOnly cookie instead; the shape is still legal.
        let answer = try decode(#"{"result":"token","access_token":"only-access","expires_in":2592000,"token_type":"Bearer","scope":"platform"}"#)

        guard case .authenticationTokenIssued(let issued) = answer else {
            Issue.record("expected a token, got \(answer)")
            return
        }
        #expect(issued.refreshToken == nil)
    }

    @Test func decodesAChallengeInItsOwnSnakeCase() throws {
        let answer = try decode(
            #"{"result":"mfa_required","challenge_id":"c_1","expires_at":"2026-09-08T12:00:00Z","factors":[{"method":"authenticator","method_id":"totp-1","kind":"possession"}]}"#
        )

        guard case .mfaRequiredResponse(let challenge) = answer else {
            Issue.record("expected a challenge, got \(answer)")
            return
        }
        #expect(challenge.challengeId == "c_1")
        #expect(challenge.factors.first?.methodId == "totp-1")
        #expect(challenge.factors.first?.method == .authenticator)
    }

    @Test func decodesTheRolesTheSessionReadAnswers() throws {
        let session = try SdkJSON.makeDecoder().decode(AuthSession.self, from: Data(#"{"actorId":"u-1","roles":["admin","listener"]}"#.utf8))

        #expect(session.roles == [.admin, .listener])
    }
}
