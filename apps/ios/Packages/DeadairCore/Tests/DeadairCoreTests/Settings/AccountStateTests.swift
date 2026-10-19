@testable import DeadairCore
import DeadairSdk
import Testing

/// The sign-in fields, and what they say after each answer. `AccountStateTest.kt`, case for case.
struct AccountStateTests {
    private let typed = AccountState(email: "operator@example.com", password: "hunter2", busy: true)
    private let challenged = AccountState(email: "operator@example.com", code: "123456", challenge: SecondFactor.authenticator(challengeId: "c_1", methodId: "totp-1"), busy: true)

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

        #expect(next == AccountState(email: "operator@example.com", challenge: SecondFactor.authenticator(challengeId: "c_1", methodId: "totp-1")))
    }

    @Test func theCodeGoesAgainstTheAuthenticatorNotWhicheverFactorIsListedFirst() {
        let next = typed.after(.secondFactorNeeded(challengeId: "c_1", factors: [factor(.email, "email-1"), factor(.authenticator, "totp-1")]))

        // The email factor rides along as the way out for somebody without their authenticator.
        #expect(next.challenge == .authenticator(challengeId: "c_1", methodId: "totp-1", email: EmailCode(challengeId: "c_1")))
    }

    @Test func saysSoWhenTheAccountsSecondFactorIsNotOneThisAppCanAnswer() {
        // Better than a code box that would refuse every code. A passkey needs a WebAuthn assertion.
        let next = typed.after(.secondFactorNeeded(challengeId: "c_1", factors: [factor(.fido, "fido-1"), factor(.phone, "phone-1")]))

        #expect(next.challenge == nil)
        #expect(next.error == .secondFactorUnsupported)
    }

    @Test func anAccountWithEmailAndAPasskeyIsSentACodeRatherThanRefused() {
        // The account that reported this: an email factor and a passkey, and no authenticator.
        let factors = [MfaChallengeFactor(method: .email, methodId: "email-1", kind: .possession, label: "o•••@example.com"), factor(.fido, "fido-1")]

        let next = typed.after(.secondFactorNeeded(challengeId: "c_1", factors: factors))

        #expect(next.challenge == .email(EmailCode(challengeId: "c_1", sentTo: "o•••@example.com")))
        #expect(next.error == nil)
        #expect(next.password == "")
        // Busy until the station says it sent one, and the page sends it because of that.
        #expect(next.needsCodeSent)
        #expect(!next.typingCode("123456").canSubmit)
    }

    @Test func aSentCodeGivesTheBoxSomethingToAnswer() {
        let sending = AccountState(email: "operator@example.com", challenge: .email(EmailCode(challengeId: "c_1")), busy: true)

        let next = sending.afterCodeSent(.sent(emailChallengeId: "e_1"))

        #expect(next.challenge == .email(EmailCode(challengeId: "c_1", emailChallengeId: "e_1")))
        #expect(!next.busy)
        #expect(!next.needsCodeSent)
        #expect(next.typingCode("123456").canSubmit)
    }

    @Test func aSendThatCannotHappenSaysWhyAndAnExpiredOneEndsTheRound() {
        let sending = AccountState(email: "operator@example.com", challenge: .email(EmailCode(challengeId: "c_1")), busy: true)

        #expect(sending.afterCodeSent(.noMail).error == .codeNoMail)
        #expect(!sending.afterCodeSent(.noMail).busy)
        #expect(sending.afterCodeSent(.failed("boom")).error == .couldNotSendCode)
        #expect(sending.afterCodeSent(.challengeExpired) == AccountState(email: "operator@example.com", error: .signInExpired))
    }

    @Test func aRefusedEmailedCodeSaysToCheckTheEmailRatherThanWait() {
        let emailed = SecondFactor.email(EmailCode(challengeId: "c_1", emailChallengeId: "e_1"))
        let challenged = AccountState(email: "operator@example.com", code: "000000", challenge: emailed, busy: true)

        let next = challenged.after(.badCredentials)

        #expect(next.error == .emailedCodeRefused)
        #expect(next.challenge == emailed)
        #expect(next.code == "")
    }

    @Test func choosingEmailKeepsTheChallengeAndAsksForASend() {
        let email = EmailCode(challengeId: "c_1")
        let challenged = AccountState(email: "operator@example.com", code: "12", challenge: .authenticator(challengeId: "c_1", methodId: "totp-1", email: email))

        let next = challenged.usingEmail()

        #expect(next.challenge == .email(email))
        #expect(next.code == "")
        #expect(next.needsCodeSent)
        // Without an email factor there is nothing to switch to.
        let alone = AccountState(email: "operator@example.com", challenge: .authenticator(challengeId: "c_1", methodId: "totp-1"))
        #expect(alone.usingEmail() == alone)
    }

    @Test func sendingAgainWaitsForTheNewSendBeforeTakingACode() {
        let sent = AccountState(email: "operator@example.com", code: "123456", challenge: .email(EmailCode(challengeId: "c_1", emailChallengeId: "e_1")))

        let again = sent.sendingAgain()

        #expect(again.needsCodeSent)
        #expect(!again.canSubmit)
        // Not twice while the station is answering.
        #expect(again.sendingAgain() == again)
    }

    @Test func anAuthenticatorStepNeverAsksForASend() {
        #expect(!challenged.needsCodeSent)
    }

    @Test func willNotSendACodeShorterThanTheStationWillTake() {
        var state = AccountState(email: "operator@example.com", challenge: SecondFactor.authenticator(challengeId: "c_1", methodId: "totp-1"))

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
        #expect(next.challenge == .authenticator(challengeId: "c_1", methodId: "totp-1"))
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
        #expect(typed.afterReset(.notAnAddress).error == .resetNotAnAddress)
        #expect(typed.afterReset(.tooMany).error == .resetTooMany)
        #expect(typed.afterReset(.noMail).error == .resetNoMail)
        let failed = typed.afterReset(.failed("timeout"))
        #expect(failed.error == .couldNotReachToReset)
        #expect(failed.password == "hunter2")
        #expect(!failed.busy)
        #expect(failed.resetSentTo == nil)
    }
}
