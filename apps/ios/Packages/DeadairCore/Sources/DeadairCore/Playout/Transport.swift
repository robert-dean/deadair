import DeadairSdk
import Foundation

/// The transport, from a pocket.
///
/// Each action applies the station's answer to the screen at once and then asks again over the next
/// seconds, which is what the console does after every action and for the same reason: the answer to
/// "skip" is the status the instant after the skip, and the encoder catching up is a second or two
/// behind it. `apps/android`'s `Transport`.
@MainActor
public final class Transport {
    private let actions: OperatorActions
    private let playout: PlayoutRepository

    public init(actions: OperatorActions, playout: PlayoutRepository) {
        self.actions = actions
        self.playout = playout
    }

    public func skip() async {
        await status { try await $0.playout.skipTheCurrentItem() }
    }

    private func status(expected: [Int: Notice] = [:], _ action: @escaping @Sendable (Deadair) async throws -> PlayoutStatus) async {
        if let answer = await actions.run(expected: expected, action) { playout.apply(answer) }
        playout.refetchSoon()
    }
}
