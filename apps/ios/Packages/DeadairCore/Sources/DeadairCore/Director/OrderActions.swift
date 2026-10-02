import DeadairSdk
import Foundation

/// What an operator does to the running order. Each answers with the order it produced, which goes
/// on screen at once. `apps/android`'s `OrderActions`.
@MainActor
public final class OrderActions {
    private let actions: OperatorActions
    private let order: OrderRepository

    public init(actions: OperatorActions, order: OrderRepository) {
        self.actions = actions
        self.order = order
    }

    /// Reorder what is still planned. The station answers whether there is enough left to shuffle.
    public func shuffle() async {
        await applying { try await $0.director.shuffleTheRunningOrder() }
    }

    private func applying(expected: [Int: Notice] = [:], _ action: @escaping @Sendable (Deadair) async throws -> StationOrder) async {
        if let answer = await actions.run(expected: expected, action) { order.apply(answer) }
    }
}
