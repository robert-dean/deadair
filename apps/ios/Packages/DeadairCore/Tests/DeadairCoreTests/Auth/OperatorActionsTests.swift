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
        let toasts = Toasts()
        let actions = OperatorActions(session: session, toasts: toasts)

        let answer = await actions.run { try await skip($0) }

        #expect(answer == true)
        #expect(toasts.current == nil)
    }

    @Test func aPlain403ReReadsTheRolesAndSaysTheAccountIsNoLongerTheOperator() async {
        let session = Session(FakeStation { _ in .json(#"{"message":"Forbidden"}"#, status: 403) })
        let toasts = Toasts()
        let actions = OperatorActions(session: session, toasts: toasts)

        let answer = await actions.run { try await skip($0) }

        #expect(answer == nil)
        #expect(toasts.current?.message == .operatorNotice(.noLongerOperator))
        #expect(session.roleReads == 1)
    }

    @Test func aStepUpIsToldApartFromARefusalAndLeavesTheRolesAlone() async {
        let body = #"{"message":"Forbidden","details":{"kind":"step_up_required"}}"#
        let session = Session(FakeStation { _ in .json(body, status: 403) })
        let toasts = Toasts()
        let actions = OperatorActions(session: session, toasts: toasts)

        _ = await actions.run { try await skip($0) }

        #expect(toasts.current?.message == .operatorNotice(.stepUpNeeded))
        #expect(session.roleReads == 0)
    }

    @Test func readsTheStepUpFromTheChallengeWhenTheBodyDoesNotSayIt() {
        #expect(namesStepUp(body: Data(#"{"message":"Forbidden"}"#.utf8), challenge: #"Bearer error="mfa_required""#))
        #expect(!namesStepUp(body: Data(#"{"message":"Forbidden"}"#.utf8), challenge: nil))
        #expect(!namesStepUp(body: Data("not json".utf8), challenge: #"Bearer error="invalid_token""#))
    }

    @Test func anExpectedStatusIsSaidInItsOwnWords() async {
        let session = Session(FakeStation { _ in .json(#"{"message":"Conflict"}"#, status: 409) })
        let toasts = Toasts()
        let actions = OperatorActions(session: session, toasts: toasts)

        _ = await actions.run(expected: [409: .nothingToResume]) { try await skip($0) }

        #expect(toasts.current?.message == .operatorNotice(.nothingToResume))
    }

    @Test func anyOtherRefusalCarriesItsStatus() async {
        let session = Session(FakeStation { _ in .json(#"{"message":"Teapot"}"#, status: 418) })
        let toasts = Toasts()
        let actions = OperatorActions(session: session, toasts: toasts)

        _ = await actions.run { try await skip($0) }

        #expect(toasts.current?.message == .operatorNotice(.failed(status: 418)))
    }

    @Test func noAnswerAtAllIsCouldNotReach() async {
        let session = Session(FakeStation { _ in .unreachable })
        let toasts = Toasts()
        let actions = OperatorActions(session: session, toasts: toasts)

        _ = await actions.run { try await skip($0) }

        #expect(toasts.current?.message == .operatorNotice(.couldNotReach))
    }

    @Test func aSessionThatEndedUnderThePressSaysNothing() async {
        let session = Session(FakeStation { _ in .json("{}") })
        session.signedOut = true
        let toasts = Toasts()
        let actions = OperatorActions(session: session, toasts: toasts)

        let answer = await actions.run { try await skip($0) }

        #expect(answer == nil)
        #expect(toasts.current == nil)
    }

    @Test func theSameNoticeTwiceIsTwoNoticesAndDismissingTheOldOneLeavesTheNew() async {
        let session = Session(FakeStation { _ in .unreachable })
        let toasts = Toasts()
        let actions = OperatorActions(session: session, toasts: toasts)

        _ = await actions.run { try await skip($0) }
        let first = toasts.current
        _ = await actions.run { try await skip($0) }
        let second = toasts.current

        #expect(first?.message == second?.message)
        #expect(first?.id != second?.id)
        toasts.dismiss(first!.id)
        #expect(toasts.current == second)
        toasts.dismiss(second!.id)
        #expect(toasts.current == nil)
    }
}
