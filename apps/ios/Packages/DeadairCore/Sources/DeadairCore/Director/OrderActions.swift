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

    /// Move an item to a position in the whole order. The station refuses anything below what the
    /// player holds rather than clamping it.
    @discardableResult
    public func move(_ itemId: String, to index: Int) async -> Bool {
        await applying { try await $0.director.moveARunningOrderItem(itemId: itemId, body: MoveStationItemInput(toIndex: index)) }
    }

    /// Take an item out. A record is spliced out entirely and can be put back with `restore`; a break
    /// is only marked removed, so the station does not plant another into the same slot a minute later.
    @discardableResult
    public func remove(_ itemId: String) async -> Bool {
        await applying { try await $0.director.removeARunningOrderItem(itemId: itemId) }
    }

    /// Undo's other half: put a dropped record back where it was. The station may refuse an index the
    /// player has passed by then.
    @discardableResult
    public func restore(trackId: UUID, at index: Int) async -> Bool {
        await applying { try await $0.director.addARecordToTheRunningOrder(body: AddStationTrackInput(trackId: trackId, atIndex: index)) }
    }

    /// Hand the broadcast to somebody else, or `nil` to hand it back to the station's own host.
    ///
    /// Breaks already written in the outgoing character are written again in the new one, so this is a
    /// change to what the station will SAY as well as to a name on a card. A 404 is a persona picked
    /// from a list the station has since changed.
    @discardableResult
    public func recast(_ personaId: String?) async -> Bool {
        await applying(expected: [404: .hostGone]) { try await $0.director.recastTheBroadcast(body: SetStationHostInput(personaId: personaId)) }
    }

    /// Programme everything the player is not already holding again.
    ///
    /// Answers 202 and nothing: the records are chosen before the old ones are dropped, so the tail
    /// keeps playing while the model works and the new set swaps in when it exists. Hence the longer
    /// follow-up reads rather than an order to apply.
    @discardableResult
    public func replan(_ input: ReplanStationInput) async -> Bool {
        let accepted = await actions.run { try await $0.director.replanTheRunningOrder(body: input) } != nil
        if accepted { order.refetchSoon() }
        return accepted
    }

    @discardableResult
    private func applying(expected: [Int: Notice] = [:], _ action: @escaping @Sendable (Deadair) async throws -> StationOrder) async -> Bool {
        guard let answer = await actions.run(expected: expected, action) else { return false }
        order.apply(answer)
        // One quick look, in case the player moved under it.
        order.retry()
        return true
    }
}
