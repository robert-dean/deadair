import DeadairSdk

/// Where a row may be moved, stated against the whole order.
public enum Move: CaseIterable, Equatable, Sendable {
    case playNext, up, down
}

/// The index a move lands on, or `nil` when the move would change nothing or is not allowed.
///
/// Never below the first planned row: the station refuses a `toIndex` inside what the player holds
/// rather than clamping it, on the grounds that quietly reordering something a listener is about to
/// hear is worse than saying no. A move that would leave the row where it is is no move at all, and a
/// control whose only effect is nothing teaches an operator to ignore it. `apps/android`'s `moveTarget`.
public func moveTarget(_ move: Move, position: Int, firstPlannedIndex: Int?, size: Int) -> Int? {
    guard let first = firstPlannedIndex, position >= first else { return nil }
    let target =
        switch move {
        case .playNext: first
        case .up: position - 1
        case .down: position + 1
        }
    guard target >= first, target <= size - 1, target != position else { return nil }
    return target
}

extension Array {
    /// This list with the item at `from` taken out and put back in at `to`, which is how a dragged row lands.
    public func moved(from: Int, to: Int) -> [Element] {
        guard from != to, indices.contains(from), indices.contains(to) else { return self }
        var copy = self
        copy.insert(copy.remove(at: from), at: to)
        return copy
    }
}

extension RunningOrderUiState {
    /// The SHOWN rows a dragged row may land on: from the first planned row to the end. `nil` when
    /// fewer than two rows are planned, since then there is nowhere to drag one to.
    ///
    /// The same floor the menu's moves keep: nothing lands among what the player has already been
    /// handed, because the station refuses such a move rather than clamping it.
    public var dragBounds: ClosedRange<Int>? {
        guard plannedCount >= 2, let firstPlanned = firstPlannedIndex else { return nil }
        let first = firstPlanned - (items.count - shown.count)
        guard first >= 0 else { return nil }
        return first...(shown.count - 1)
    }

    /// Where a row dragged in the list lands in the WHOLE order, or `nil` when the drop is refused.
    ///
    /// `offset` is SwiftUI's: the shown index the row is inserted BEFORE, counted in the list as it was
    /// before the move. So a row dragged down lands one above the offset it reports.
    public func dropTarget(from: Int, offset: Int) -> Int? {
        guard let bounds = dragBounds, bounds.contains(from), shown.indices.contains(from), !shown[from].isSpent else { return nil }
        let landing = offset > from ? offset - 1 : offset
        guard landing != from, bounds.contains(landing) else { return nil }
        return positionOf(shownIndex: landing)
    }
}
