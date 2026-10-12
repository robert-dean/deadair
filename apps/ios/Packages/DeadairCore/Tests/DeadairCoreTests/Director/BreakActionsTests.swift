@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// Asking the station to say something.
///
/// The case worth guarding is the decline: it is a 200, so nothing in the shared failure path says it,
/// and a press the station turned down would otherwise look exactly like one it took.
@MainActor
struct BreakActionsTests {
    private func actions(_ fake: FakeStation, _ toasts: Toasts) -> BreakActions {
        BreakActions(actions: OperatorActions(session: OperatorActionsTests.Session(fake), toasts: toasts))
    }

    @Test func asksForTheNewsNextAndSaysItWasTaken() async {
        let sent = Sent()
        let fake = FakeStation { request in
            await sent.keep(request.path, request.body)
            return .json(#"{"accepted":true,"requestId":"r-1","segmentId":"s-1"}"#)
        }
        let toasts = Toasts()

        #expect(await actions(fake, toasts).request(.news))

        #expect(await sent.path?.hasSuffix("/director/air/breaks") == true)
        let body = try? JSONSerialization.jsonObject(with: Data((await sent.body ?? "").utf8)) as? [String: String]
        #expect(body == ["kind": "news", "urgency": "next"])
        #expect(toasts.current?.message == .operatorNotice(.breakAsked(.news)))
    }

    @Test func aDeclineIsSaidWithTheStationsOwnReason() async {
        let fake = FakeStation { _ in .json(#"{"accepted":false,"reason":"the station has been told not to interrupt itself"}"#) }
        let toasts = Toasts()

        #expect(await !actions(fake, toasts).request(.weather))

        #expect(toasts.current?.message == .operatorNotice(.breakDeclined(reason: "the station has been told not to interrupt itself")))
    }

    @Test func aDeclineWithNoReasonIsStillSaid() async {
        let toasts = Toasts()

        #expect(await !actions(FakeStation { _ in .json(#"{"accepted":false}"#) }, toasts).request(.talkbreak))

        #expect(toasts.current?.message == .operatorNotice(.breakDeclined(reason: nil)))
    }

    @Test func aRefusalGoesThroughTheSharedPath() async {
        let toasts = Toasts()

        #expect(await !actions(FakeStation { _ in .json(#"{"message":"boom"}"#, status: 500) }, toasts).request(.news))

        #expect(toasts.current?.message == .operatorNotice(.failed(status: 500)))
    }
}

/// What the fake station was sent, kept across the actor the fake answers on.
private actor Sent {
    private(set) var path: String?
    private(set) var body: String?

    func keep(_ path: String, _ body: String) {
        self.path = path
        self.body = body
    }
}
