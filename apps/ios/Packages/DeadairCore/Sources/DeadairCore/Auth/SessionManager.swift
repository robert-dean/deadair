import DeadairSdk
import Foundation
import Observation

/// Nothing is signed in to this station, so the call that needed a session was never made.
public struct NotSignedIn: Error, Equatable {}

/// What came of offering an email and a password, or a code against a pending challenge.
public enum SignInResult: Equatable, Sendable {
    case ok

    /// The station read the credentials, or the code, and said no. Fixed by typing again.
    case badCredentials

    /// The station wants a second factor before it will issue anything.
    ///
    /// A 200 rather than an error, which is why signing in answers with a result instead of
    /// throwing: a client reading the status alone sees a successful sign-in with no token in it.
    /// `factors` lists every factor that would satisfy the challenge, of which this app can answer
    /// the authenticator and nothing else.
    case secondFactorNeeded(challengeId: String, factors: [MfaChallengeFactor])

    /// The challenge is gone: it expired, or it was already spent. A code cannot answer it, and
    /// the password step has to be done again.
    case challengeExpired

    /// The station will not accept that factor for this challenge: almost always a bug here.
    case factorRefused

    /// A token with nothing to renew it from. Refused rather than kept, because the session would
    /// otherwise end when the access token does, with no way back and nothing said at the time.
    case noRefreshToken

    /// Anything else: no network, a station that is down. Carries the diagnostic, never shown.
    case failed(String?)
}

/// What the operator's controls need from a session, and nothing more. The seam the operator's
/// remote is built on.
@MainActor
public protocol OperatorSession: AnyObject {
    var state: SessionState { get }
    func withSession<T: Sendable>(_ body: @escaping @Sendable (Deadair) async throws -> T) async throws -> T
    func refreshRoles() async throws
}

/// The signed-in half of the app.
///
/// **Listening needs none of this.** `/nowplaying` and the mounts are public, which is the whole
/// design of the station's edge, so an install that never signs in loses nothing it came for. What
/// a session buys is the station's own account of itself, which sits behind `platform.view`
/// because it is the console's data being read by a phone.
///
/// **The token is attached per request, not per SDK.** `SdkConfig.headers` is called once per
/// request, so the bearer is read at the moment of the call rather than baked in when the client
/// was built, and a retry after a refresh carries the NEW token through the same client.
///
/// **A refresh is single-flight, and that is not tidiness.** The station's refresh tokens are
/// single-use and rotating, and presenting a spent one revokes every token descended from that
/// sign-in at once. Two readings meeting the same expiry is the ordinary case, so the second caller
/// waits for the first one's refresh rather than starting its own, and a caller whose token was
/// already replaced takes the replacement rather than refreshing again. Taking a second turn would
/// be exactly the replay the station treats as theft.
///
/// **A session ends on a 4xx to the refresh and on nothing else.** Not a network failure, not a
/// 5xx: a tunnel reconnecting or a phone changing cell would otherwise sign the operator out several
/// times a day.
@MainActor
@Observable
public final class SessionManager: OperatorSession {
    /// The session on disk, as last read or written.
    public private(set) var stored: StoredSession?
    public private(set) var station: StationUrl?

    @ObservationIgnored private let storage: SessionStorage
    @ObservationIgnored private let sdkFor: @Sendable (StationUrl, @escaping @Sendable () async throws -> [String: String]) -> Deadair
    @ObservationIgnored private var refreshing: Task<StoredSession?, Error>?
    @ObservationIgnored private var rolesEnsuredFor: String?
    @ObservationIgnored private var ensuring: Task<Void, Never>?

    /// `sdkFor` is one SDK for one station, carrying whatever headers it is handed.
    public init(
        storage: SessionStorage,
        station: StationUrl?,
        sdkFor: @escaping @Sendable (StationUrl, @escaping @Sendable () async throws -> [String: String]) -> Deadair
    ) {
        self.storage = storage
        self.sdkFor = sdkFor
        self.stored = storage.load()
        self.station = nil
        point(at: station)
    }

    public var state: SessionState { sessionFor(stored, station: station) }

    /// The app is now pointed at `station`.
    ///
    /// A token for a station this app is no longer pointed at is not merely unusable, it is
    /// something to be rid of: `state` already reports it as signed out, so keeping it buys
    /// nothing and leaves one station's bearer in an install now aimed at another.
    public func point(at station: StationUrl?) {
        self.station = station
        if let stored, let station, stored.origin != station.origin {
            clear()
        }
    }

    /// Exchange an email and a password for a session. The password is not kept, here or anywhere.
    public func signIn(_ station: StationUrl, email: String, password: String) async -> SignInResult {
        let answer: AuthenticationTokenResponse
        do {
            answer = try await requestToken(station, .passwordAuthenticationRequest(PasswordAuthenticationRequest(username: email, password: password)))
        } catch let error as SdkError where Self.credentialRefusals.contains(error.status) {
            // 400 for a grant it will not honour, 401 for credentials it read and rejected. Both
            // are fixed by typing again.
            return .badCredentials
        } catch {
            return .failed(String(describing: error))
        }
        return await accept(station, email: email, answer: answer)
    }

    /// Answer a pending challenge with a code from an authenticator app.
    ///
    /// `methodId` is the factor the code belongs to and has to be one the challenge listed: TOTP
    /// has no other binding to the account at initial login, so the station cannot work out which
    /// authenticator six digits are supposed to be from.
    public func completeSecondFactor(_ station: StationUrl, email: String, challengeId: String, methodId: String, code: String) async -> SignInResult {
        let answer: AuthenticationTokenResponse
        do {
            let grant = AuthenticatorAuthenticationRequest(code: code, mfaChallengeId: challengeId, methodId: methodId)
            answer = try await requestToken(station, .authenticatorAuthenticationRequest(grant))
        } catch let error as SdkError where Self.credentialRefusals.contains(error.status) {
            // Three different refusals arrive as one status, and the station names which in
            // `WWW-Authenticate`.
            switch error.authError {
            case invalidChallenge: return .challengeExpired
            case invalidFactor: return .factorRefused
            default: return .badCredentials
            }
        } catch {
            return .failed(String(describing: error))
        }
        return await accept(station, email: email, answer: answer)
    }

    /// Keep whatever the token endpoint answered with, whichever grant asked for it.
    private func accept(_ station: StationUrl, email: String, answer: AuthenticationTokenResponse) async -> SignInResult {
        switch answer {
        case .mfaRequiredResponse(let challenge):
            return .secondFactorNeeded(challengeId: challenge.challengeId, factors: challenge.factors)
        case .authenticationTokenIssued(let issued):
            guard let refreshToken = issued.refreshToken else { return .noRefreshToken }
            save(StoredSession(origin: station.origin, email: email, accessToken: issued.accessToken, refreshToken: refreshToken))
            // The roles ride one request behind the tokens. A failure here is not a failed
            // sign-in: the session is real, so it is swallowed and the next start asks again.
            // Until then the account draws as a listener.
            try? await refreshRoles()
            return .ok
        }
    }

    /// Unauthenticated, because none of the grants that reach it have a session yet.
    private func requestToken(_ station: StationUrl, _ request: AuthenticationRequest) async throws -> AuthenticationTokenResponse {
        try await sdkFor(station) { [:] }.authentication.requestToken(body: request)
    }

    /// Ask the station which platform roles this account holds, and remember the answer.
    ///
    /// A 403 is an answer: the account holds no role at all. It is stored as no roles rather than
    /// left as whatever was cached, because a cache saying `admin` about an account the station has
    /// just refused is the one state this method exists to correct.
    public func refreshRoles() async throws {
        let roles: Set<PlatformRole>
        do {
            roles = Set(try await withSession { try await $0.authenticationSessions.readSession() }.roles)
        } catch let error as SdkError where error.status == 403 {
            roles = []
        }
        guard var current = stored, current.roles != roles else { return }
        current.roles = roles
        save(current)
    }

    /// Refresh the roles once per process for the session that is signed in, so a role granted or
    /// taken away since the last run is noticed without waiting for a 403. A failure leaves the
    /// cached roles standing and is not remembered as done, so the next caller tries again.
    public func ensureRoles() async {
        if let ensuring {
            await ensuring.value
            return
        }
        guard let key = key(stored), rolesEnsuredFor != key else { return }
        let task = Task { [weak self] in
            guard let self else { return }
            if (try? await self.refreshRoles()) != nil { self.rolesEnsuredFor = key }
        }
        ensuring = task
        await task.value
        ensuring = nil
    }

    /// End the session, here and at the station.
    ///
    /// The local clear happens whatever the station says: a listener who has asked to be signed out
    /// is signed out, and an unreachable station is not a reason to keep their tokens on this phone.
    public func signOut() async {
        if let station, let session = stored, session.origin == station.origin {
            let bearer = session.accessToken
            // Best effort. The station revokes the session if it hears about it, and forgets it in
            // thirty days if it does not.
            try? await sdkFor(station) { ["Authorization": "Bearer \(bearer)"] }.authenticationSessions.logout()
        }
        clear()
    }

    /// Run one call as the signed-in account, refreshing once if the station says the token is old.
    ///
    /// Throws `NotSignedIn` when there is no session for the current station rather than answering
    /// with something empty: "signed out" and "nothing to show" are different screens.
    public func withSession<T: Sendable>(_ body: @escaping @Sendable (Deadair) async throws -> T) async throws -> T {
        guard let station, let session = stored, session.origin == station.origin else { throw NotSignedIn() }

        // Read by the header closure, so the retry sends the token the refresh produced through
        // the very same client.
        let token = Locked(session.accessToken)
        let sdk = sdkFor(station) { ["Authorization": "Bearer \(token.value)"] }

        do {
            return try await body(sdk)
        } catch let error as SdkError where error.status == 401 {
            guard let renewed = try await refreshed(station, spent: token.value) else { throw NotSignedIn() }
            token.set(renewed.accessToken)
            // Once. A second 401 on a token the station has just issued is the station saying
            // something other than "this is old", and repeating the call would not find out what.
            return try await body(sdk)
        }
    }

    /// Trade the refresh token for a new pair, one caller at a time. Answers the session to carry
    /// on with, or `nil` when there is none to be had, in which case the store is already cleared.
    private func refreshed(_ station: StationUrl, spent: String) async throws -> StoredSession? {
        // Somebody is refreshing right now. Their answer is the good one.
        if let refreshing { return try await refreshing.value }

        guard let current = stored else { return nil }
        // Somebody refreshed while this call was on its way here. Their token is the live one, and
        // presenting the refresh token again would be the replay that revokes the family.
        if current.accessToken != spent { return current }

        let task = Task { [sdkFor] () throws -> StoredSession? in
            let answer: AuthenticationTokenResponse
            do {
                let grant = RefreshTokenAuthenticationRequest(refreshToken: current.refreshToken)
                answer = try await sdkFor(station) { [:] }.authentication.requestToken(body: .refreshTokenAuthenticationRequest(grant))
            } catch let error as SdkError where (400..<500).contains(error.status) {
                // Spent, revoked, or the account is gone. None of those improve on a retry.
                return nil
            }
            guard case .authenticationTokenIssued(let issued) = answer else { return nil }
            // A rotation answers with both halves. Keeping the old refresh token when it does not
            // is the safe way round: presenting a retired one costs a 401, while dropping a good
            // one costs the session.
            var next = current
            next.accessToken = issued.accessToken
            next.refreshToken = issued.refreshToken ?? current.refreshToken
            return next
        }
        refreshing = task
        defer { refreshing = nil }

        // A 5xx or a network failure is rethrown with the session untouched.
        let next = try await task.value
        if let next { save(next) } else { clear() }
        return next
    }

    private func save(_ session: StoredSession) {
        stored = session
        storage.save(session)
    }

    private func clear() {
        stored = nil
        rolesEnsuredFor = nil
        storage.clear()
    }

    private func key(_ session: StoredSession?) -> String? {
        session.map { "\($0.origin)|\($0.email)" }
    }

    /// A grant the station will not honour, and one it read and rejected. Both are retyped.
    private static let credentialRefusals: Set<Int> = [400, 401]
}

/// A value a `@Sendable` closure can read while the main actor changes it.
final class Locked<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Value

    init(_ value: Value) {
        stored = value
    }

    var value: Value { lock.withLock { stored } }

    func set(_ value: Value) {
        lock.withLock { stored = value }
    }
}
