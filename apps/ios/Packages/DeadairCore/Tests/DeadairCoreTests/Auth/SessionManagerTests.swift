@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// The session's policy: what carries the bearer, what a 401 costs, and what ends a session.
///
/// The single-flight test is the one that matters most. The station's refresh tokens are single-use
/// and a replay revokes every token descended from the same sign-in, so two readings meeting the
/// same expiry must produce exactly one refresh, not two that happen to work in testing and sign
/// the operator out in the field. `SessionManagerTest.kt`, case for case.
@MainActor
struct SessionManagerTests {
    private func history(_ manager: SessionManager) async throws -> HistoryPage {
        try await manager.withSession { try await $0.history.readHistory() }
    }

    // MARK: Attaching the bearer

    @Test func carriesTheStoredTokenOnEveryCall() async throws {
        let fake = FakeStation { _ in .json(Bodies.history) }
        let manager = manager(MemorySessionStorage(signedIn()), fake)

        _ = try await history(manager)

        #expect(fake.requests.map(\.authorization) == ["Bearer access-1"])
    }

    @Test func refusesToCallAtAllWhenNothingIsSignedIn() async {
        let fake = FakeStation { _ in .json(Bodies.history) }
        let manager = manager(MemorySessionStorage(), fake)

        await #expect(throws: NotSignedIn.self) { try await history(manager) }
        // "Signed out" is answered here, not by a 401.
        #expect(fake.requests.isEmpty)
    }

    @Test func refusesWhenTheSessionBelongsToAnotherStationAndForgetsIt() async {
        var elsewhere = signedIn()
        elsewhere.origin = "https://elsewhere.example.com"
        let storage = MemorySessionStorage(elsewhere)
        let fake = FakeStation { _ in .json(Bodies.history) }
        let manager = manager(storage, fake)

        await #expect(throws: NotSignedIn.self) { try await history(manager) }
        #expect(fake.requests.isEmpty)
        // Another station's bearer is not kept in an install aimed elsewhere.
        #expect(storage.session == nil)
    }

    // MARK: Refreshing

    @Test func refreshesOnceOnA401AndReplaysTheCallWithTheNewToken() async throws {
        let storage = MemorySessionStorage(signedIn())
        let fake = FakeStation { request in
            if request.path.hasSuffix("/auth/token") { return .json(Bodies.token("access-2")) }
            if request.authorization == "Bearer access-1" { return .empty(401) }
            return .json(Bodies.history)
        }
        let manager = manager(storage, fake)

        let page = try await history(manager)

        #expect(page.entries.isEmpty)
        #expect(storage.session?.accessToken == "access-2")
        // The rotated refresh token replaces the spent one, or the next refresh replays a dead one.
        #expect(storage.session?.refreshToken == "refresh-2")
        #expect(fake.requests.map(\.authorization) == ["Bearer access-1", nil, "Bearer access-2"])
        #expect(fake.requests[1].body.contains("grant_type=refresh_token"))
        #expect(fake.requests[1].body.contains("refresh_token=refresh-1"))
    }

    @Test func refreshesExactlyOnceWhenTwoCallsMeetTheSameExpiry() async throws {
        let storage = MemorySessionStorage(signedIn())
        let bothExpired = Barrier(2)
        let fake = FakeStation { request in
            if request.path.hasSuffix("/auth/token") { return .json(Bodies.token("access-2")) }
            if request.authorization == "Bearer access-1" {
                // Both calls hold the old token before either hears it is old.
                await bothExpired.arrive()
                return .empty(401)
            }
            return .json(Bodies.history)
        }
        let manager = manager(storage, fake)

        async let one = history(manager)
        async let two = history(manager)
        _ = try await (one, two)

        #expect(fake.requests.filter { $0.path.hasSuffix("/auth/token") }.count == 1)
        #expect(storage.session?.accessToken == "access-2")
    }

    @Test func endsTheSessionWhenTheStationRefusesTheRefreshToken() async {
        let storage = MemorySessionStorage(signedIn())
        let fake = FakeStation { _ in .empty(401) }
        let manager = manager(storage, fake)

        await #expect(throws: NotSignedIn.self) { try await history(manager) }
        #expect(storage.session == nil)
        #expect(storage.cleared == 1)
        #expect(manager.state == .signedOut)
    }

    @Test func keepsTheSessionWhenTheRefreshCannotBeReached() async {
        // A tunnel reconnecting or a phone changing cell is not the end of a session.
        let storage = MemorySessionStorage(signedIn())
        let fake = FakeStation { request in request.path.hasSuffix("/auth/token") ? .unreachable : .empty(401) }
        let manager = manager(storage, fake)

        await #expect(throws: URLError.self) { try await history(manager) }
        #expect(storage.session == signedIn())
        #expect(storage.cleared == 0)
    }

    @Test func keepsTheSessionWhenTheStationIsMerelyHavingABadMinute() async {
        let storage = MemorySessionStorage(signedIn())
        let fake = FakeStation { request in request.path.hasSuffix("/auth/token") ? .empty(500) : .empty(401) }
        let manager = manager(storage, fake)

        _ = try? await history(manager)

        #expect(storage.session == signedIn())
        #expect(storage.cleared == 0)
    }

    @Test func letsAFailureThatIsNotA401ThroughUntouched() async {
        let storage = MemorySessionStorage(signedIn())
        let fake = FakeStation { _ in .empty(403) }
        let manager = manager(storage, fake)

        _ = try? await history(manager)

        // One call, no refresh: a 403 is the account lacking the role, which no new token fixes.
        #expect(fake.requests.count == 1)
        #expect(storage.session == signedIn())
    }

    // MARK: Signing in and out

    @Test func signsInWithThePasswordGrantAndRemembersWhereTheTokenCameFrom() async {
        let storage = MemorySessionStorage()
        let fake = FakeStation { request in
            request.path.hasSuffix("/auth/session") ? .json(Bodies.session("admin")) : .json(Bodies.token("access-9", refresh: "refresh-9"), status: 201)
        }
        let manager = manager(storage, fake)

        let result = await manager.signIn(station(), email: "operator@example.com", password: "hunter2")

        #expect(result == .ok)
        #expect(storage.session == StoredSession(origin: station().origin, email: "operator@example.com", accessToken: "access-9", refreshToken: "refresh-9", roles: [.admin]))
        // The roles ride one request behind the token, carrying the bearer it just issued.
        #expect(fake.requests.last?.path.hasSuffix("/auth/session") == true)
        #expect(fake.requests.last?.authorization == "Bearer access-9")
        // Form-encoded, which is what the token endpoint takes and what the generated client sends.
        #expect(fake.requests.first?.body.contains("grant_type=password") == true)
        #expect(fake.requests.first?.body.contains("username=operator%40example.com") == true)
        #expect(manager.state.isOperator)
    }

    @Test func stillSignsInWhenTheStationCannotSayWhatTheAccountMayDo() async {
        let storage = MemorySessionStorage()
        let fake = FakeStation { request in
            request.path.hasSuffix("/auth/session") ? .empty(500) : .json(Bodies.token("access-9", refresh: "refresh-9"), status: 201)
        }
        let manager = manager(storage, fake)

        #expect(await manager.signIn(station(), email: "operator@example.com", password: "hunter2") == .ok)
        #expect(storage.session?.roles == [])
    }

    @Test func refusesATokenWithNothingToRenewItFrom() async {
        let storage = MemorySessionStorage()
        let fake = FakeStation { _ in .json(Bodies.token("access-9", refresh: nil)) }
        let manager = manager(storage, fake)

        #expect(await manager.signIn(station(), email: "operator@example.com", password: "hunter2") == .noRefreshToken)
        #expect(storage.session == nil)
    }

    @Test func reportsBadCredentialsAsSomethingTheListenerCanFix() async {
        let storage = MemorySessionStorage()
        let manager = manager(storage, FakeStation { _ in .empty(401) })

        #expect(await manager.signIn(station(), email: "operator@example.com", password: "wrong") == .badCredentials)
        #expect(storage.session == nil)
    }

    @Test func reportsAnUnreachableStationAsSomethingElse() async {
        let storage = MemorySessionStorage()
        let manager = manager(storage, FakeStation { _ in .unreachable })

        let result = await manager.signIn(station(), email: "operator@example.com", password: "hunter2")

        guard case .failed = result else {
            Issue.record("expected failed, got \(result)")
            return
        }
        #expect(storage.session == nil)
    }

    @Test func signsOutEvenWhenTheStationCannotBeTold() async {
        let storage = MemorySessionStorage(signedIn())
        let manager = manager(storage, FakeStation { _ in .unreachable })

        await manager.signOut()

        #expect(storage.session == nil)
        #expect(storage.cleared == 1)
    }

    @Test func signsOutAtTheStationAsWell() async {
        let storage = MemorySessionStorage(signedIn())
        let fake = FakeStation { _ in .empty(204) }
        let manager = manager(storage, fake)

        await manager.signOut()

        #expect(fake.requests.count == 1)
        #expect(fake.requests.first?.path.hasSuffix("/auth/logout") == true)
        #expect(fake.requests.first?.authorization == "Bearer access-1")
        #expect(storage.session == nil)
    }

    // MARK: Roles

    @Test func aRefusedRolesReadMeansNoRolesWhateverTheCacheSaid() async throws {
        let storage = MemorySessionStorage(signedIn(roles: [.admin]))
        let manager = manager(storage, FakeStation { _ in .empty(403) })

        try await manager.refreshRoles()

        #expect(storage.session?.roles == [])
        #expect(!manager.state.isOperator)
    }

    @Test func aRolesReadThatCannotBeReachedLeavesTheCacheStanding() async {
        let storage = MemorySessionStorage(signedIn(roles: [.admin]))
        let manager = manager(storage, FakeStation { _ in .unreachable })

        await #expect(throws: URLError.self) { try await manager.refreshRoles() }
        #expect(storage.session?.roles == [.admin])
    }

    @Test func ensuresTheRolesOncePerProcessHoweverManyScreensAsk() async {
        let storage = MemorySessionStorage(signedIn())
        let fake = FakeStation { _ in .json(Bodies.session("admin")) }
        let manager = manager(storage, fake)

        await manager.ensureRoles()
        await manager.ensureRoles()

        #expect(fake.requests.count == 1)
        #expect(storage.session?.roles == [.admin])
        #expect(manager.state.isOperator)
    }

    @Test func aFailedEnsureIsNotRememberedAsDone() async {
        let storage = MemorySessionStorage(signedIn())
        let asked = Locked(0)
        let fake = FakeStation { _ in
            asked.set(asked.value + 1)
            return asked.value == 1 ? .unreachable : .json(Bodies.session("listener"))
        }
        let manager = manager(storage, fake)

        await manager.ensureRoles()
        await manager.ensureRoles()

        #expect(asked.value == 2)
        #expect(storage.session?.roles == [.listener])
    }

    // MARK: What the screens read

    @Test func reportsTheAccountASessionBelongsTo() {
        let manager = manager(MemorySessionStorage(signedIn()), FakeStation { _ in .json(Bodies.history) })

        #expect(manager.state == .signedIn(email: "operator@example.com", roles: []))
    }

    @Test func reportsSignedOutWhenTheAppIsPointedAtNoStationAtAll() {
        let manager = manager(MemorySessionStorage(signedIn()), station: nil, FakeStation { _ in .json(Bodies.history) })

        #expect(manager.state == .signedOut)
    }
}
