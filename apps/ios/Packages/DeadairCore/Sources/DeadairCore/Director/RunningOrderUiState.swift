import DeadairSdk

extension StationOrderItem {
    /// Whether an item is beyond editing: the player has it, or it is behind us.
    public var isSpent: Bool { state != .planned }

    /// How loud a row is: full for now and next, half for history, a quarter for a skipped break,
    /// which arrives in runs.
    public var opacity: Double {
        switch state {
        case .airing, .planned: 1
        case .skipped where segmentId != nil: 0.25
        default: 0.5
        }
    }

    /// What the row says about where it has got to, in the console's words. Nothing for a planned
    /// record; for a planned break that will not be heard, why not, in three readings rather than
    /// one, because "will skip" on nine rows at once said the station was failing when it was working.
    public var stateLabel: Message? {
        guard state == .planned else { return .itemState(state) }
        guard kind == .segment, playable == false else { return nil }
        switch segmentState {
        case .planned, .writing: return .notWrittenYet
        case .written, .rendering: return .noAudioYet
        default: return .willSkip
        }
    }
}

/// The running order as the tab lays it out: the history folded behind a count, the row the order is
/// read from, and the two indices every operator action is stated against.
///
/// Pure, and the console's rules exactly, so a phone and a desk agree about which row is the anchor
/// and where a move is allowed to land. `apps/android`'s `RunningOrderUiState`.
public struct RunningOrderUiState: Equatable, Sendable {
    public let items: [StationOrderItem]
    public let historyOpen: Bool

    public init(items: [StationOrderItem], historyOpen: Bool = false) {
        self.items = items
        self.historyOpen = historyOpen
    }

    /// Which row the order is read FROM: the item on air when there is one, else the first item
    /// nothing has spent. `nil` for an order that is entirely behind us.
    public var anchorIndex: Int? {
        items.firstIndex { $0.state == .airing } ?? items.firstIndex { $0.state == .planned || $0.state == .handed }
    }

    /// The lowest position an item may be moved to, and the only one the tab ever asks for. The
    /// station refuses a move below what has been committed rather than clamping it, and the first
    /// planned row is always at or above that line. `nil` when nothing is planned.
    public var firstPlannedIndex: Int? { items.firstIndex { $0.state == .planned } }

    /// How many rows can still be reordered, which is what decides whether Shuffle means anything.
    public var plannedCount: Int { items.count(where: { $0.state == .planned }) }

    /// Everything before the anchor, by POSITION: a removed item among the planned ones is still ahead.
    public var folded: [StationOrderItem] {
        guard !historyOpen, let anchor = anchorIndex, anchor > 0 else { return [] }
        return Array(items[..<anchor])
    }

    public var shown: [StationOrderItem] {
        guard let anchor = anchorIndex, !folded.isEmpty else { return items }
        return Array(items[anchor...])
    }

    /// Where a shown row sits in the WHOLE order, which is the number a move is stated against.
    public func positionOf(shownIndex: Int) -> Int { shownIndex + (items.count - shown.count) }

    /// What the fold is called, counting only what it holds. `nil` when nothing is folded.
    public var historyLabel: Message? {
        let rows = folded
        guard !rows.isEmpty else { return nil }
        return .foldedHistory(
            played: rows.count(where: { $0.state == .played }),
            passed: rows.count(where: { $0.state == .skipped || $0.state == .unavailable })
        )
    }
}
