import Foundation
import DeadairSdk

/// A code the station emails, against a pending challenge. `apps/android`'s `SecondFactor.Email`.
///
/// `emailChallengeId` is the message's id, which the code grant echoes back, and is absent until the
/// station has said it sent one: there is nothing to type before that. `sentTo` is the station's
/// label for the address, usually masked, when it gave one.
public struct EmailCode: Equatable, Sendable {
    public let challengeId: String
    public var sentTo: String?
    public var emailChallengeId: String?

    public init(challengeId: String, sentTo: String? = nil, emailChallengeId: String? = nil) {
        self.challengeId = challengeId
        self.sentTo = sentTo
        self.emailChallengeId = emailChallengeId
    }
}

/// The challenge a code is being typed against, and where the code comes from.
///
/// Every case carries the challenge, which says which pending sign-in this is. What else it needs
/// depends on the factor, because the station binds the two kinds of code differently.
public enum SecondFactor: Equatable, Sendable {
    /// A code from an authenticator app. The method id says which enrolled authenticator the six
    /// digits are supposed to be from: TOTP has no other binding to the account at initial login,
    /// so a code sent without the right method id is refused, and refused in a way that reads at
    /// the keyboard exactly like a wrong code.
    ///
    /// `email` is set when the account can also be sent a code, for somebody whose authenticator is
    /// on a phone they do not have with them.
    case authenticator(challengeId: String, methodId: String, email: EmailCode? = nil)

    /// A code the station emails.
    case email(EmailCode)

    public var challengeId: String {
        switch self {
        case .authenticator(let challengeId, _, _): challengeId
        case .email(let code): code.challengeId
        }
    }

    /// The emailed code, when that is what is being typed.
    public var emailed: EmailCode? {
        if case .email(let code) = self { return code }
        return nil
    }
}

/// The sign-in fields, as the settings screen shows them.
///
/// The password lives here while it is being typed and nowhere else. It is cleared the moment the
/// station answers, either way: a wrong one is not worth keeping on screen and a right one has
/// already been traded for a token.
///
/// Two steps rather than one, and which one is showing is `challenge` rather than a flag: the code
/// step needs the challenge's identifiers to send anything at all, so a boolean saying "on the code
/// step" would be a second copy of the answer that could disagree with the first.
public struct AccountState: Equatable, Sendable {
    public var email = ""
    public var password = ""
    public var code = ""
    /// Set once the station has asked for a second factor, and the only thing that draws the code box.
    public var challenge: SecondFactor?
    public var busy = false
    public var error: Message?
    /// The address a password-reset link was asked for, once the station has answered. Set, the
    /// page says to check that inbox instead of drawing the form.
    public var resetSentTo: String?

    public init(
        email: String = "",
        password: String = "",
        code: String = "",
        challenge: SecondFactor? = nil,
        busy: Bool = false,
        error: Message? = nil,
        resetSentTo: String? = nil
    ) {
        self.email = email
        self.password = password
        self.code = code
        self.challenge = challenge
        self.busy = busy
        self.error = error
        self.resetSentTo = resetSentTo
    }

    /// The shortest code the station's contract will take.
    public static let codeLength = 6

    /// Enough typed to be worth sending. Not validation: the station decides. The code is the one
    /// exception, and it is arithmetic rather than judgement: the contract will not take fewer
    /// than six digits, so sending three spends an attempt against the rate limit for nothing.
    public var canSubmit: Bool {
        if busy { return false }
        // Nothing to type against until the station has said it sent the email.
        if let emailed = challenge?.emailed, emailed.emailChallengeId == nil { return false }
        if challenge != nil { return code.count >= Self.codeLength }
        return !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    /// Typing again clears the last answer: what failed is no longer what is in the fields.
    public func typingEmail(_ email: String) -> AccountState { with { $0.email = email; $0.error = nil } }

    public func typingPassword(_ password: String) -> AccountState { with { $0.password = password; $0.error = nil } }

    public func typingCode(_ code: String) -> AccountState { with { $0.code = code; $0.error = nil } }

    /// Back to the password step, keeping the email: for somebody who cannot reach their code, and
    /// for every outcome that leaves nothing to answer.
    public func startingAgain() -> AccountState { AccountState(email: email) }

    /// Whether the page is waiting on an emailed code to be sent, which the page then asks for.
    ///
    /// Read by the page after every change rather than each caller deciding, so the three ways into
    /// a send (a challenge that leads with email, choosing email, sending again) cannot disagree
    /// about when one is due.
    public var needsCodeSent: Bool {
        guard busy, let emailed = challenge?.emailed else { return false }
        return emailed.emailChallengeId == nil
    }

    /// "Email me a code instead", from the authenticator step. Busy, because the send is next; the
    /// challenge stays the same one, so nothing about the password step is repeated.
    public func usingEmail() -> AccountState {
        guard !busy, case .authenticator(_, _, let email?) = challenge else { return self }
        return with { $0.code = ""; $0.challenge = .email(email); $0.busy = true; $0.error = nil }
    }

    /// "Send it again": the same challenge, asked for once more. The message id is dropped until the
    /// station answers, so nothing is submitted against a send that is still in flight.
    public func sendingAgain() -> AccountState {
        guard !busy, var emailed = challenge?.emailed else { return self }
        emailed.emailChallengeId = nil
        return with { $0.challenge = .email(emailed); $0.busy = true; $0.error = nil }
    }

    /// What the code step shows once the station has answered a send. Sent gives the box something
    /// to type against; an expired challenge ends the round, as it does on the code.
    public func afterCodeSent(_ result: CodeSendResult) -> AccountState {
        guard var emailed = challenge?.emailed else { return with { $0.busy = false } }
        switch result {
        case .sent(let emailChallengeId):
            emailed.emailChallengeId = emailChallengeId
            return with { $0.challenge = .email(emailed); $0.busy = false; $0.error = nil }
        case .challengeExpired:
            return startingAgain().with { $0.error = .signInExpired }
        case .noMail:
            return with { $0.busy = false; $0.error = .codeNoMail }
        case .failed:
            return with { $0.busy = false; $0.error = .couldNotSendCode }
        }
    }

    /// Asking for a password-reset link: busy, or told why not.
    ///
    /// Only the address is needed, the password being what this is instead of. With none typed the
    /// answer is to type one, decided here rather than by sending a blank address to be told so.
    public func askingReset() -> AccountState {
        if busy { return self }
        if email.trimmingCharacters(in: .whitespaces).isEmpty { return with { $0.error = .resetNeedsEmail } }
        return with { $0.busy = true; $0.error = nil }
    }

    /// What the fields show once the station has answered a reset request. Sent leaves the form for
    /// the check-your-inbox state, keeping the email for when they come back to sign in.
    public func afterReset(_ result: ResetResult) -> AccountState {
        switch result {
        case .sent: return AccountState(email: email, resetSentTo: email.trimmingCharacters(in: .whitespaces))
        case .notAnAddress: return with { $0.busy = false; $0.error = .resetNotAnAddress }
        case .tooMany: return with { $0.busy = false; $0.error = .resetTooMany }
        case .noMail: return with { $0.busy = false; $0.error = .resetNoMail }
        case .failed: return with { $0.busy = false; $0.error = .couldNotReachToReset }
        }
    }

    /// Turn the station's answer into what the fields show next.
    ///
    /// A refusal keeps the email and drops the password, which is the half that is probably wrong.
    /// Anything else keeps both: a listener whose station was unreachable should not have to type
    /// it all again once it is back.
    public func after(_ result: SignInResult) -> AccountState {
        switch result {
        case .ok:
            return AccountState()

        case .secondFactorNeeded(let challengeId, let factors):
            // The AUTHENTICATOR out of the challenge first, never its first entry: a challenge
            // lists every enrolled factor in enrolment order. An authenticator costs nothing to
            // offer, where choosing email sends a message, so email leads only when there is no
            // authenticator.
            let email = emailFactor(factors).map { EmailCode(challengeId: challengeId, sentTo: $0.label) }
            let next: SecondFactor
            if let authenticator = authenticatorFactors(factors).first {
                next = .authenticator(challengeId: challengeId, methodId: authenticator.methodId, email: email)
            } else if let email {
                next = .email(email)
            } else {
                // Saying so beats a code box that would refuse every code.
                return with { $0.password = ""; $0.busy = false; $0.error = .secondFactorUnsupported }
            }
            // An emailed code stays busy, because the send that gives it something to type is next.
            return with {
                $0.password = ""
                $0.code = ""
                $0.challenge = next
                $0.busy = next.emailed != nil
                $0.error = nil
            }

        // Which field was wrong depends on which step asked. On the code step the email and
        // password were accepted a moment ago.
        case .badCredentials:
            if challenge == nil { return with { $0.password = ""; $0.busy = false; $0.error = .badCredentials } }
            // An authenticator's next code is half a minute away; an emailed one is the same code
            // until it is sent again, so the advice differs.
            let refused: Message = challenge?.emailed != nil ? .emailedCodeRefused : .codeRefused
            return with { $0.code = ""; $0.busy = false; $0.error = refused }

        // Neither can be answered by trying harder, so the code box goes away.
        case .challengeExpired:
            return startingAgain().with { $0.error = .signInExpired }
        case .factorRefused:
            return startingAgain().with { $0.error = .factorRefused }

        case .noRefreshToken:
            return with { $0.busy = false; $0.error = .noRefreshToken }

        case .failed:
            // The diagnostic is not shown. It is written for whoever wrote the station rather than
            // whoever is holding the phone, and it does not say what to do next.
            return with { $0.busy = false; $0.error = .couldNotReachToSignIn }
        }
    }

    private func with(_ change: (inout AccountState) -> Void) -> AccountState {
        var copy = self
        change(&copy)
        return copy
    }
}
