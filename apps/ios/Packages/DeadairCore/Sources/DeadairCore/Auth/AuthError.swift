import DeadairSdk
import Foundation

/// The station's own name for what went wrong, out of `WWW-Authenticate`.
///
/// The token endpoint refuses several different things with the same 401, and the status alone
/// cannot tell them apart: `invalid_grant` is a wrong code, `invalid_challenge` is a sign-in that
/// has expired, and `invalid_factor` is a code sent against a factor the challenge does not list.
/// The remedies are "type it again", "start again" and "this app has a bug", so collapsing them into
/// one sentence tells the operator the one thing that is not true.
///
/// Parsed rather than matched whole, because the header is a challenge with parameters
/// (`Bearer error="invalid_factor", error_description="..."`) and the station is free to add more.
public func authError(inChallenge challenge: String?) -> String? {
    guard let challenge, let match = challenge.firstMatch(of: /error="([^"]*)"/) else { return nil }
    return String(match.1)
}

/// The station has forgotten the challenge: it expired, or it was already spent.
public let invalidChallenge = "invalid_challenge"

/// The factor the code was sent against is not one the challenge lists. Always a client bug.
public let invalidFactor = "invalid_factor"

extension SdkError {
    /// What the station named in `WWW-Authenticate`, or `nil` when it sent none.
    public var authError: String? {
        DeadairCore.authError(inChallenge: headers["www-authenticate"] ?? headers["WWW-Authenticate"])
    }
}

/// Which of a challenge's factors this app can answer: the AUTHENTICATOR, and only that.
///
/// A challenge lists every factor the account has enrolled, in ENROLMENT order, so the first entry
/// is not reliably the one a code box can satisfy: an email factor enrolled first sits ahead of the
/// authenticator. The station refuses a code sent with another factor's method id as
/// `invalid_factor`, which at the keyboard reads exactly like a mistyped code. The desktop app
/// shipped sending the first factor, and the report that came back was "the 2FA code is not
/// accepted".
///
/// The others are not oversights. A phone or email factor needs a challenge started against it
/// first, and FIDO needs a WebAuthn assertion this app has no way to produce; both are the
/// console's job. An empty answer is what lets the screen SAY that.
public func authenticatorFactors(_ factors: [MfaChallengeFactor]) -> [MfaChallengeFactor] {
    factors.filter { $0.method == .authenticator }
}
