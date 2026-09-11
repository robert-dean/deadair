import DeadairSdk
import Foundation
import Testing

/// That a token grant leaves this client in the shape the station reads.
///
/// `/auth/token` declares `application/x-www-form-urlencoded` BEFORE `application/json` and the
/// generator uses the first declared type, so a grant is sent as a form. That is correct and
/// invisible at the call site; what it means is that the grant's fields travel through the form
/// encoder, so a wrong wire name makes a wrong form field and sign-in fails against a server that
/// is behaving perfectly. The desktop's `TokenRequestEncodeTests`.
struct TokenRequestEncodeTests {
    private func form(_ grant: AuthenticationRequest) throws -> String {
        let http = SdkHttp(config: SdkConfig(baseURL: URL(string: "https://example.invalid/api")!))
        var request = SdkRequest(method: "POST", path: ["auth", "token"])
        try http.setFormBody(&request, grant, contentType: "application/x-www-form-urlencoded")
        #expect(request.contentType == "application/x-www-form-urlencoded")
        return String(decoding: request.body ?? Data(), as: UTF8.self)
    }

    @Test func writesAPasswordGrantAsAForm() throws {
        let body = try form(.passwordAuthenticationRequest(PasswordAuthenticationRequest(username: "operator@example.com", password: "hunter2")))

        #expect(body.contains("grant_type=password"))
        #expect(body.contains("username=operator%40example.com"))
        #expect(body.contains("password=hunter2"))
    }

    @Test func writesARefreshGrantAsAForm() throws {
        let body = try form(.refreshTokenAuthenticationRequest(RefreshTokenAuthenticationRequest(refreshToken: "rt_9f8e7d6c")))

        #expect(body.contains("grant_type=refresh_token"))
        #expect(body.contains("refresh_token=rt_9f8e7d6c"))
    }

    @Test func carriesTheChallengeIdOnTheProofGrant() throws {
        // `mfa_challenge_id` and `method_id` bind this grant to the challenge, and both are snake
        // on the wire.
        let body = try form(.authenticatorAuthenticationRequest(AuthenticatorAuthenticationRequest(code: "123456", mfaChallengeId: "c_0193f2a1", methodId: "f_1")))

        #expect(body.contains("grant_type=authenticator"))
        #expect(body.contains("mfa_challenge_id=c_0193f2a1"))
        #expect(body.contains("method_id=f_1"))
        #expect(body.contains("code=123456"))
    }

    @Test func doesNotSendAnAbsentOptionalAsAnEmptyField() throws {
        // The server tells "not supplied" from "supplied as nothing" on several of these.
        let body = try form(.refreshTokenAuthenticationRequest(RefreshTokenAuthenticationRequest(refreshToken: "rt_9f8e7d6c")))

        #expect(!body.contains("scope="))
        #expect(!body.contains("client_id="))
    }
}
