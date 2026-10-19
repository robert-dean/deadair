@testable import DeadairCore
import DeadairSdk
import Testing

/// Answering a second factor, and the three ways the station refuses one.
///
/// All three arrive as the same 401 and are told apart only by `WWW-Authenticate`. The desktop app
/// shipped without reading it, reported every refusal as "that code was not accepted", and the one
/// report that came back was from an operator whose code was fine: the app had sent it against the
/// wrong factor.
@MainActor
struct SecondFactorTests {
    private func factor(_ method: AuthenticationFactorMethod, _ id: String) -> MfaChallengeFactor {
        MfaChallengeFactor(method: method, methodId: id, kind: .possession)
    }

    private func code(_ answer: FakeStation.Answer, methodId: String = "totp-1") async -> SignInResult {
        let manager = manager(MemorySessionStorage(), FakeStation { _ in answer })
        return await manager.completeSecondFactor(station(), email: "operator@example.com", challengeId: "c_1", methodId: methodId, code: "123456")
    }

    @Test func picksTheAuthenticatorRatherThanWhicheverFactorIsFirst() {
        let factors = [factor(.email, "email-1"), factor(.authenticator, "totp-1")]

        #expect(authenticatorFactors(factors).map(\.methodId) == ["totp-1"])
    }

    @Test func answersNothingWhenTheAccountHasNoAuthenticator() {
        // An email factor is answered by a different grant, after a send, so it is not one of these.
        let factors = [factor(.email, "email-1")]

        #expect(authenticatorFactors(factors).isEmpty)
        #expect(emailFactor(factors)?.methodId == "email-1")
    }

    @Test func findsNoEmailFactorWhereThereIsNone() {
        #expect(emailFactor([factor(.fido, "fido-1")]) == nil)
    }

    @Test func readsTheErrorOutOfAChallengeWithOtherParametersBesideIt() {
        #expect(authError(inChallenge: #"Bearer realm="deadair", error="invalid_factor", error_description="no""#) == "invalid_factor")
        #expect(authError(inChallenge: #"Bearer realm="deadair""#) == nil)
        #expect(authError(inChallenge: nil) == nil)
    }

    @Test func aPasswordStepThatStopsAtAChallengeIsNotAFailure() async {
        let storage = MemorySessionStorage()
        let manager = manager(storage, FakeStation { _ in .json(Bodies.challenge) })

        let result = await manager.signIn(station(), email: "operator@example.com", password: "hunter2")

        guard case .secondFactorNeeded(let challengeId, let factors) = result else {
            Issue.record("expected a challenge, got \(result)")
            return
        }
        #expect(challengeId == "c_1")
        // In the station's order, which is enrolment order rather than usefulness order.
        #expect(factors.map(\.methodId) == ["email-1", "totp-1"])
        // Nothing is kept: there is no session until the challenge is answered.
        #expect(storage.session == nil)
    }

    @Test func aRightCodeFinishesTheSignInAndCarriesTheFactorItBelongsTo() async {
        let storage = MemorySessionStorage()
        let fake = FakeStation { request in
            request.path.hasSuffix("/auth/session") ? .json(Bodies.session("admin")) : .json(Bodies.token("access-9", refresh: "refresh-9"), status: 201)
        }
        let manager = manager(storage, fake)

        let result = await manager.completeSecondFactor(station(), email: "operator@example.com", challengeId: "c_1", methodId: "totp-1", code: "123456")

        #expect(result == .ok)
        #expect(storage.session?.accessToken == "access-9")
        #expect(storage.session?.refreshToken == "refresh-9")
        let body = fake.requests.first?.body ?? ""
        #expect(body.contains("grant_type=authenticator"))
        #expect(body.contains("mfa_challenge_id=c_1"))
        #expect(body.contains("method_id=totp-1"))
        #expect(body.contains("code=123456"))
    }

    @Test func aWrongCodeIsReportedAsAWrongCode() async {
        #expect(await code(.refusal("invalid_grant")) == .badCredentials)
    }

    @Test func aFactorTheStationWillNotAcceptIsNotAWrongCode() async {
        #expect(await code(.refusal("invalid_factor"), methodId: "email-1") == .factorRefused)
    }

    @Test func anExpiredChallengeIsItsOwnAnswer() async {
        #expect(await code(.refusal("invalid_challenge")) == .challengeExpired)
    }

    @Test func aRefusalThatNamesNothingIsTreatedAsAWrongCode() async {
        // Retyping a code is free; sending somebody back to the password step when the code was
        // merely mistyped is not.
        #expect(await code(.empty(401)) == .badCredentials)
    }

    // MARK: An emailed code

    @Test func asksTheStationToEmailACodeForTheChallenge() async {
        let fake = FakeStation { _ in .json(#"{"method":"email","email_challenge_id":"e_1","expires_at":"2026-09-08T12:10:00Z"}"#) }
        let manager = manager(MemorySessionStorage(), fake)

        #expect(await manager.sendEmailCode(station(), challengeId: "c_1") == .sent(emailChallengeId: "e_1"))

        let request = fake.requests.first
        #expect(request?.path.hasSuffix("/auth/factors/start") == true)
        let body = request?.body ?? ""
        #expect(body.contains(#""method":"email""#))
        #expect(body.contains(#""mfa_challenge_id":"c_1""#))
        // Before there is a session, so nothing to carry.
        #expect(request?.authorization == nil)
    }

    @Test func aSendAgainstASpentChallengeOrAStationWithNoMailSaysWhich() async {
        let expired = manager(MemorySessionStorage(), FakeStation { _ in .refusal("invalid_challenge") })
        #expect(await expired.sendEmailCode(station(), challengeId: "c_1") == .challengeExpired)

        let noMail = manager(MemorySessionStorage(), FakeStation { _ in .json(#"{"message":"mail is not configured"}"#, status: 503) })
        #expect(await noMail.sendEmailCode(station(), challengeId: "c_1") == .noMail)

        let down = manager(MemorySessionStorage(), FakeStation { _ in .unreachable })
        guard case .failed = await down.sendEmailCode(station(), challengeId: "c_1") else {
            Issue.record("expected a failure")
            return
        }
    }

    @Test func anEmailedCodeIsAnsweredWithTheCodeGrantAndTheMessageItCameIn() async {
        let storage = MemorySessionStorage()
        let fake = FakeStation { request in
            request.path.hasSuffix("/auth/session") ? .json(Bodies.session("admin")) : .json(Bodies.token("access-9", refresh: "refresh-9"), status: 201)
        }
        let manager = manager(storage, fake)

        let result = await manager.completeEmailCode(station(), email: "operator@example.com", challengeId: "c_1", emailChallengeId: "e_1", code: "123456")

        #expect(result == .ok)
        #expect(storage.session?.accessToken == "access-9")
        let body = fake.requests.first?.body ?? ""
        #expect(body.contains("grant_type=code"))
        #expect(body.contains("mfa_challenge_id=c_1"))
        #expect(body.contains("challenge_id=e_1"))
        #expect(body.contains("code=123456"))
        #expect(!body.contains("method_id"))
    }

    @Test func aWrongEmailedCodeIsReportedAsAWrongCode() async {
        let manager = manager(MemorySessionStorage(), FakeStation { _ in .refusal("invalid_grant") })

        #expect(await manager.completeEmailCode(station(), email: "operator@example.com", challengeId: "c_1", emailChallengeId: "e_1", code: "000000") == .badCredentials)
    }
}
