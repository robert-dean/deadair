import DeadairSdk

/// A signed-in session, as it survives the app being killed.
///
/// The origin is part of it rather than beside it. A token is issued by ONE station and means
/// nothing to another, so a session that did not record where it came from would be offered to
/// whatever address the app is pointed at next: a 401 at best, and somebody else's station reading
/// this listener's bearer at worst.
///
/// The email is here only to be shown back ("signed in as ..."). Nothing authenticates with it
/// after the first exchange; the tokens do.
public struct StoredSession: Codable, Equatable, Sendable {
    public var origin: String
    public var email: String
    public var accessToken: String
    public var refreshToken: String
    /// What the station said this account may do, as of the last time it was asked. Cached so a
    /// cold start knows what to draw before the first network answer; re-read on every start and
    /// whenever the station answers 403 to something the cache said was allowed.
    public var roles: Set<PlatformRole>

    public init(origin: String, email: String, accessToken: String, refreshToken: String, roles: Set<PlatformRole> = []) {
        self.origin = origin
        self.email = email
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.roles = roles
    }
}

/// Where a session is kept.
///
/// A protocol for one real implementation, the Keychain. The reason is the one
/// `NowPlayingRepository` takes a function rather than the SDK: what `SessionManager` is FOR is
/// the policy (when to refresh, when to give up, what a station change means) and none of it needs
/// a keychain to be exercised. Synchronous, because the Keychain is, and fast enough for the main
/// actor.
@MainActor
public protocol SessionStorage: AnyObject {
    func load() -> StoredSession?
    func save(_ session: StoredSession)
    func clear()
}

/// A session kept only for as long as the process lives. The tests' store, and a fallback.
@MainActor
public final class MemorySessionStorage: SessionStorage {
    public private(set) var session: StoredSession?
    public private(set) var cleared = 0

    public init(_ session: StoredSession? = nil) {
        self.session = session
    }

    public func load() -> StoredSession? { session }

    public func save(_ session: StoredSession) { self.session = session }

    public func clear() {
        cleared += 1
        session = nil
    }
}

/// Whether this app is signed in to the station it is currently pointed at.
///
/// Two states and no third. There is deliberately no `expired`: a token here is refreshed when a
/// call comes back 401 rather than on a clock, so "expired" is not a state a screen can be in; it
/// happens inside one request and is over before the caller hears about it.
public enum SessionState: Equatable, Sendable {
    case signedOut

    /// Signed in, holding whichever platform roles the station last reported.
    ///
    /// The roles are a HINT about what to draw and never a gate: the API decides every operation
    /// for itself, and a control drawn on a cached role can still be refused. What they buy is not
    /// drawing a Skip button the station is about to say no to.
    case signedIn(email: String, roles: Set<PlatformRole>)

    /// Whether the station said this account may operate it. `admin` grants everything.
    public var isOperator: Bool {
        if case .signedIn(_, let roles) = self { return roles.contains(.admin) }
        return false
    }
}

/// Whether a stored session counts for this station.
///
/// A token belongs to the station that issued it, so pointing the app somewhere else signs it out:
/// not because the old session has ended, but because it is not this station's to honour.
public func sessionFor(_ stored: StoredSession?, station: StationUrl?) -> SessionState {
    guard let stored, let station, stored.origin == station.origin else { return .signedOut }
    return .signedIn(email: stored.email, roles: stored.roles)
}
