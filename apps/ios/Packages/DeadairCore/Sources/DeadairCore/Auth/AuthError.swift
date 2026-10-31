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

/// What the station puts in the challenge when it refuses a refresh: `invalid_token` for a token
/// that is spent, revoked or unreadable, `invalid_grant` for one whose account is gone, and
/// `invalid_request` for none at all. Every other name belongs to some other grant.
private let refreshRefusals: Set<String> = ["invalid_request", "invalid_token", "invalid_grant"]

extension SdkError {
    /// What the station named in `WWW-Authenticate`, or `nil` when it sent none.
    public var authError: String? {
        DeadairCore.authError(inChallenge: headers["www-authenticate"] ?? headers["WWW-Authenticate"])
    }

    /// Whether the STATION refused a refresh, which is the only answer that ends a session.
    ///
    /// A 401 carrying one of those names, rather than any 4xx, because a 4xx on this route is not
    /// reliably a verdict on the token. The station's own limiter answers 429 and runs before the
    /// route, a tunnel or a WAF answers 403, a proxy answers 401 or 404, and none of those looked at
    /// the token. The challenge is what separates them: this request carries no bearer, and RFC 6750
    /// §3.1 has anything challenging a request without credentials leave the error code out, so a
    /// proxy's 401 names none of these. The same rule as `isRefreshRefused` in the console,
    /// `SdkError.refusesRefresh` on Android and `ApiError.RefusesRefresh` on the desktop.
    var refusesRefresh: Bool {
        status == 401 && authError.map(refreshRefusals.contains) == true
    }
}

/// Which of a challenge's factors this app can answer with an authenticator code.
///
/// A challenge lists every factor the account has enrolled, in ENROLMENT order, so the first entry
/// is not reliably the one a code box can satisfy: an email factor enrolled first sits ahead of the
/// authenticator. The station refuses a code sent with another factor's method id as
/// `invalid_factor`, which at the keyboard reads exactly like a mistyped code. The desktop app
/// shipped sending the first factor, and the report that came back was "the 2FA code is not
/// accepted".
public func authenticatorFactors(_ factors: [MfaChallengeFactor]) -> [MfaChallengeFactor] {
    factors.filter { $0.method == .authenticator }
}

/// The challenge's email factor, if it has one: the other factor this app can answer.
/// `apps/android`'s `emailFactor`.
///
/// An emailed code needs a challenge started against it first (`POST /auth/factors/start`), which is
/// what sends the message. An account with an email factor and a passkey and nothing else was refused
/// outright until this existed, because the passkey is the one factor left over: FIDO needs a
/// WebAuthn assertion this app has no way to produce, and that stays the console's job. So does a
/// phone factor.
public func emailFactor(_ factors: [MfaChallengeFactor]) -> MfaChallengeFactor? {
    factors.first { $0.method == .email }
}
