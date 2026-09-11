import Foundation
import DeadairSdk

/// The challenge a code is being typed against.
///
/// Both halves, because the station needs both: the challenge says which pending sign-in this is,
/// and the method id says which enrolled authenticator the six digits are supposed to be from.
public struct SecondFactor: Equatable, Sendable {
    public let challengeId: String
    public let methodId: String
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

    public init(email: String = "", password: String = "", code: String = "", challenge: SecondFactor? = nil, busy: Bool = false, error: Message? = nil) {
        self.email = email
        self.password = password
        self.code = code
        self.challenge = challenge
        self.busy = busy
        self.error = error
    }

    /// The shortest code the station's contract will take.
    public static let codeLength = 6

    /// Enough typed to be worth sending. Not validation: the station decides. The code is the one
    /// exception, and it is arithmetic rather than judgement: the contract will not take fewer
    /// than six digits, so sending three spends an attempt against the rate limit for nothing.
    public var canSubmit: Bool {
        if busy { return false }
        if challenge != nil { return code.count >= Self.codeLength }
        return !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty
    }

    /// Typing again clears the last answer: what failed is no longer what is in the fields.
    public func typingEmail(_ email: String) -> AccountState { with { $0.email = email; $0.error = nil } }

    public func typingPassword(_ password: String) -> AccountState { with { $0.password = password; $0.error = nil } }

    public func typingCode(_ code: String) -> AccountState { with { $0.code = code; $0.error = nil } }

    /// Back to the password step, keeping the email: for somebody who cannot reach their
    /// authenticator, and for every outcome that leaves nothing to answer.
    public func startingAgain() -> AccountState { AccountState(email: email) }

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
            // The AUTHENTICATOR out of the challenge, never its first entry.
            guard let factor = authenticatorFactors(factors).first else {
                // Saying so beats a code box that would refuse every code.
                return with { $0.password = ""; $0.busy = false; $0.error = .secondFactorUnsupported }
            }
            return with {
                $0.password = ""
                $0.code = ""
                $0.challenge = SecondFactor(challengeId: challengeId, methodId: factor.methodId)
                $0.busy = false
                $0.error = nil
            }

        // Which field was wrong depends on which step asked. On the code step the email and
        // password were accepted a moment ago.
        case .badCredentials:
            if challenge == nil { return with { $0.password = ""; $0.busy = false; $0.error = .badCredentials } }
            return with { $0.code = ""; $0.busy = false; $0.error = .codeRefused }

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
