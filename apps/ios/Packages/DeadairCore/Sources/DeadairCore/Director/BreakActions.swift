import DeadairSdk
import Foundation

/// Asking the station to say something now, rather than when its format clock next calls for it.
/// `apps/android`'s `BreakActions`.
///
/// The station decides where the break goes and whether there is one at all, so this never reads the
/// running order to guess. Either answer is said: an accepted request because the break is not heard
/// until it has been written and spoken, which is longer than a press should go unanswered, and a
/// decline with the station's own reason, because "breaks are off" or "one went in a moment ago" is
/// what the operator needs to read. A decline is a 200 rather than a refusal, so it never reaches
/// `OperatorActions.run`'s failure path and has to be told here.
///
/// The urgency is always `next`: between the record on air and the one after, once the break exists.
/// The phone offers no other, since `interrupt` talks over a record and the slower two are what the
/// station's own clock is already for.
@MainActor
public final class BreakActions {
    private let actions: OperatorActions

    public init(actions: OperatorActions) {
        self.actions = actions
    }

    @discardableResult
    public func request(_ kind: RequestableBreakKind) async -> Bool {
        guard let answer = await actions.run({ try await $0.director.requestABreak(body: RequestStationBreakInput(kind: kind, urgency: .next)) }) else {
            return false
        }
        actions.tell(answer.accepted ? .breakAsked(kind) : .breakDeclined(reason: answer.reason))
        return answer.accepted
    }
}
