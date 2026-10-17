@testable import DeadairCore
import DeadairSdk
import Testing

/// The sign-in fields, and what they say after each answer. `AccountStateTest.kt`, case for case.
struct AccountStateTests {
    private let typed = AccountState(email: "operator@example.com", password: "hunter2", busy: true)
    private let challenged = AccountState(email: "operator@example.com", code: "123456", challenge: SecondFactor(challengeId: "c_1", methodId: "totp-1"), busy: true)

    private func factor(_ method: AuthenticationFactorMethod, _ id: String) -> MfaChallengeFactor {
        MfaChallengeFactor(method: method, methodId: id, kind: .possession)
    }

    @Test func willNotSubmitUntilBothFieldsHaveSomethingInThem() {
        #expect(!AccountState().canSubmit)
        #expect(!AccountState(email: "operator@example.com").canSubmit)
        #expect(!AccountState(password: "hunter2").canSubmit)
        #expect(AccountState(email: "operator@example.com", password: "hunter2").canSubmit)
    }

    @Test func willNotSubmitTwiceWhileTheStationIsAnswering() {
        #expect(!typed.canSubmit)
    }

    @Test func typingAgainClearsTheLastAnswer() {
        let refused = AccountState(email: "operator@example.com", error: .badCredentials)

        #expect(refused.typingEmail("someone@example.com").error == nil)
        #expect(refused.typingPassword("h").error == nil)
    }

    @Test func signingInEmptiesTheFieldsPasswordIncluded() {
        #expect(typed.after(.ok) == AccountState())
    }

    @Test func aRefusalKeepsTheEmailAndDropsThePassword() {
        let next = typed.after(.badCredentials)

        #expect(next == AccountState(email: "operator@example.com", error: .badCredentials))
    }

    @Test func anUnreachableStationKeepsBothSoNothingIsRetypedOnceItIsBack() {
        let next = typed.after(.failed("Connection refused"))

        #expect(next.email == "operator@example.com")
        #expect(next.password == "hunter2")
        #expect(!next.busy)
    }

    @Test func doesNotShowTheListenerTheStationsOwnWords() {
        #expect(typed.after(.failed("NSURLErrorDomain -1001")).error == .couldNotReachToSignIn)
    }

    @Test func namesWhatTheStationAskedForThatThisAppCannotDo() {
        #expect(typed.after(.noRefreshToken).error == .noRefreshToken)
    }

    @Test func aChallengeMovesToTheCodeStepAndDropsThePassword() {
        let next = typed.after(.secondFactorNeeded(challengeId: "c_1", factors: [factor(.authenticator, "totp-1")]))

        #expect(next == AccountState(email: "operator@example.com", challenge: SecondFactor(challengeId: "c_1", methodId: "totp-1")))
    }

    @Test func theCodeGoesAgainstTheAuthenticatorNotWhicheverFactorIsListedFirst() {
        let next = typed.after(.secondFactorNeeded(challengeId: "c_1", factors: [factor(.email, "email-1"), factor(.authenticator, "totp-1")]))

        #expect(next.challenge == SecondFactor(challengeId: "c_1", methodId: "totp-1"))
    }

    @Test func saysSoWhenTheAccountsSecondFactorIsNotOneThisAppCanAnswer() {
        let next = typed.after(.secondFactorNeeded(challengeId: "c_1", factors: [factor(.email, "email-1")]))

        #expect(next.challenge == nil)
        #expect(next.error == .secondFactorUnsupported)
    }

    @Test func willNotSendACodeShorterThanTheStationWillTake() {
        var state = AccountState(email: "operator@example.com", challenge: SecondFactor(challengeId: "c_1", methodId: "totp-1"))

        state.code = "123"
        #expect(!state.canSubmit)
        state.code = "123456"
        #expect(state.canSubmit)
        state.busy = true
        #expect(!state.canSubmit)
    }

    @Test func aRefusedCodeIsNotARefusedPassword() {
        let next = challenged.after(.badCredentials)

        #expect(next.error == .codeRefused)
        #expect(next.code == "")
        // Still on the code step: another code from the same authenticator will work.
        #expect(next.challenge == SecondFactor(challengeId: "c_1", methodId: "totp-1"))
    }

    @Test func anExpiredChallengeAndARefusedFactorBothEndTheRound() {
        #expect(challenged.after(.challengeExpired) == AccountState(email: "operator@example.com", error: .signInExpired))
        #expect(challenged.after(.factorRefused) == AccountState(email: "operator@example.com", error: .factorRefused))
    }

    @Test func startingAgainKeepsTheEmailAndNothingElse() {
        #expect(challenged.startingAgain() == AccountState(email: "operator@example.com"))
    }

    // MARK: A forgotten password

    @Test func aResetNeedsOnlyTheAddressAndSaysSoWhenThereIsNone() {
        #expect(AccountState().askingReset().error == .resetNeedsEmail)
        #expect(!AccountState().askingReset().busy)

        let asking = AccountState(email: "operator@example.com").askingReset()
        #expect(asking.busy)
        #expect(asking.error == nil)
    }

    @Test func aResetIsNotAskedTwiceWhileTheStationIsAnswering() {
        #expect(typed.askingReset() == typed)
    }

    @Test func aSentLinkLeavesTheFormForTheInboxKeepingTheAddressForComingBack() {
        let sent = AccountState(email: " operator@example.com ", password: "half typed", busy: true).afterReset(.sent)

        #expect(sent.resetSentTo == "operator@example.com")
        #expect(sent.email == " operator@example.com ")
        #expect(sent.password.isEmpty)
        #expect(!sent.busy)
        #expect(sent.startingAgain() == AccountState(email: " operator@example.com "))
    }

    @Test func aRefusedResetSaysWhyAndKeepsWhatWasTyped() {
        #expect(typed.afterReset(.tooMany).error == .resetTooMany)
        #expect(typed.afterReset(.noMail).error == .resetNoMail)
        let failed = typed.afterReset(.failed("timeout"))
        #expect(failed.error == .couldNotReachToReset)
        #expect(failed.password == "hunter2")
        #expect(!failed.busy)
        #expect(failed.resetSentTo == nil)
    }
}
