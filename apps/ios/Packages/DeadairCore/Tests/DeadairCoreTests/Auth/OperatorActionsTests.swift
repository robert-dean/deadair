@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// The one path every operator call takes: what a refusal turns into, and when the roles are re-read.
@MainActor
struct OperatorActionsTests {
    /// A session that hands the action an SDK over a fake station, and counts role re-reads.
    final class Session: OperatorSession {
        var state: SessionState = .signedIn(email: "operator@example.com", roles: [.admin])
        var roleReads = 0
        var signedOut = false
        let fake: FakeStation

        init(_ fake: FakeStation) { self.fake = fake }

        func withSession<T: Sendable>(_ body: @escaping @Sendable (Deadair) async throws -> T) async throws -> T {
            if signedOut { throw NotSignedIn() }
            return try await body(sdk(for: station(), fake.transport))
        }

        func refreshRoles() async throws { roleReads += 1 }
    }

    /// Any signed-in call will do; this one has a body `FakeStation` already knows how to answer.
    private func skip(_ deadair: Deadair) async throws -> Bool {
        _ = try await deadair.authenticationSessions.readSession()
        return true
    }

    @Test func answersWhatTheStationAnsweredAndPostsNothing() async {
        let session = Session(FakeStation { _ in .json(Bodies.session("admin")) })
        let actions = OperatorActions(session: session)

        let answer = await actions.run { try await skip($0) }

        #expect(answer == true)
        #expect(actions.notice == nil)
    }

    @Test func aPlain403ReReadsTheRolesAndSaysTheAccountIsNoLongerTheOperator() async {
        let session = Session(FakeStation { _ in .json(#"{"message":"Forbidden"}"#, status: 403) })
        let actions = OperatorActions(session: session)

        let answer = await actions.run { try await skip($0) }

        #expect(answer == nil)
        #expect(actions.notice?.notice == .noLongerOperator)
        #expect(session.roleReads == 1)
    }

    @Test func aStepUpIsToldApartFromARefusalAndLeavesTheRolesAlone() async {
        let body = #"{"message":"Forbidden","details":{"kind":"step_up_required"}}"#
        let session = Session(FakeStation { _ in .json(body, status: 403) })
        let actions = OperatorActions(session: session)

        _ = await actions.run { try await skip($0) }

        #expect(actions.notice?.notice == .stepUpNeeded)
        #expect(session.roleReads == 0)
    }

    @Test func readsTheStepUpFromTheChallengeWhenTheBodyDoesNotSayIt() {
        #expect(namesStepUp(body: Data(#"{"message":"Forbidden"}"#.utf8), challenge: #"Bearer error="mfa_required""#))
        #expect(!namesStepUp(body: Data(#"{"message":"Forbidden"}"#.utf8), challenge: nil))
        #expect(!namesStepUp(body: Data("not json".utf8), challenge: #"Bearer error="invalid_token""#))
    }

    @Test func anExpectedStatusIsSaidInItsOwnWords() async {
        let session = Session(FakeStation { _ in .json(#"{"message":"Conflict"}"#, status: 409) })
        let actions = OperatorActions(session: session)

        _ = await actions.run(expected: [409: .nothingToResume]) { try await skip($0) }

        #expect(actions.notice?.notice == .nothingToResume)
    }

    @Test func anyOtherRefusalCarriesItsStatus() async {
        let session = Session(FakeStation { _ in .json(#"{"message":"Teapot"}"#, status: 418) })
        let actions = OperatorActions(session: session)

        _ = await actions.run { try await skip($0) }

        #expect(actions.notice?.notice == .failed(status: 418))
    }

    @Test func noAnswerAtAllIsCouldNotReach() async {
        let session = Session(FakeStation { _ in .unreachable })
        let actions = OperatorActions(session: session)

        _ = await actions.run { try await skip($0) }

        #expect(actions.notice?.notice == .couldNotReach)
    }

    @Test func aSessionThatEndedUnderThePressSaysNothing() async {
        let session = Session(FakeStation { _ in .json("{}") })
        session.signedOut = true
        let actions = OperatorActions(session: session)

        let answer = await actions.run { try await skip($0) }

        #expect(answer == nil)
        #expect(actions.notice == nil)
    }

    @Test func theSameNoticeTwiceIsTwoNoticesAndDismissingTheOldOneLeavesTheNew() async {
        let session = Session(FakeStation { _ in .unreachable })
        let actions = OperatorActions(session: session)

        _ = await actions.run { try await skip($0) }
        let first = actions.notice
        _ = await actions.run { try await skip($0) }
        let second = actions.notice

        #expect(first?.notice == second?.notice)
        #expect(first?.id != second?.id)
        actions.dismiss(first!.id)
        #expect(actions.notice == second)
        actions.dismiss(second!.id)
        #expect(actions.notice == nil)
    }
}
