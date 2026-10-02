@testable import DeadairCore
import DeadairSdk
import Testing

/// The console's rules for reading the order: where it is read from, what folds away, and where a
/// move may land. `apps/android`'s `RunningOrderUiStateTest`, case for case.
struct RunningOrderUiStateTests {
    private let items = [
        orderItem("a", .played),
        orderItem("b", .skipped, kind: .segment),
        orderItem("c", .played),
        orderItem("d", .airing),
        orderItem("e", .handed),
        orderItem("f", .planned),
        orderItem("g", .planned),
    ]

    @Test func readsFromTheItemOnAir() {
        #expect(RunningOrderUiState(items: items).anchorIndex == 3)
    }

    @Test func readsFromTheFirstUnspentItemWhenNothingIsOnAir() {
        let stoodDown = items.map { item in
            var copy = item
            if copy.state == .airing { copy.state = .played }
            return copy
        }
        #expect(RunningOrderUiState(items: stoodDown).anchorIndex == 4)
    }

    @Test func anOrderEntirelyBehindUsHasNoAnchorAndFoldsNothing() {
        let ui = RunningOrderUiState(items: [orderItem("a", .played), orderItem("b", .played)])
        #expect(ui.anchorIndex == nil)
        #expect(ui.shown.map(\.id) == ["a", "b"])
        #expect(ui.historyLabel == nil)
    }

    @Test func foldsEverythingBeforeTheAnchorAndCountsWhatItHolds() {
        let ui = RunningOrderUiState(items: items)

        #expect(ui.folded.map(\.id) == ["a", "b", "c"])
        #expect(ui.shown.map(\.id) == ["d", "e", "f", "g"])
        #expect(ui.historyLabel == .foldedHistory(played: 2, passed: 1))
        // The first shown row is the fourth in the whole order.
        #expect(ui.positionOf(shownIndex: 0) == 3)
    }

    @Test func openingTheHistoryShowsEveryRow() {
        let ui = RunningOrderUiState(items: items, historyOpen: true)

        #expect(ui.shown.count == 7)
        #expect(ui.historyLabel == nil)
        #expect(ui.positionOf(shownIndex: 0) == 0)
    }

    @Test func aMoveMayLandNoLowerThanTheFirstPlannedRow() {
        #expect(RunningOrderUiState(items: items).firstPlannedIndex == 5)
        #expect(RunningOrderUiState(items: items).plannedCount == 2)
    }

    @Test func aPlannedRecordSaysNothingAndASpentOneSaysWhereItGotTo() {
        #expect(orderItem("x", .planned).stateLabel == nil)
        #expect(orderItem("x", .handed).stateLabel == .itemState(.handed))
    }

    @Test func aBreakThatCannotAirYetSaysWhyInThreeReadings() {
        func segment(_ state: StationOrderItemSegmentState?) -> StationOrderItem {
            orderItem("s", .planned, kind: .segment, segmentState: state, playable: false)
        }

        #expect(segment(.writing).stateLabel == .notWrittenYet)
        #expect(segment(.rendering).stateLabel == .noAudioYet)
        #expect(segment(.failed).stateLabel == .willSkip)
        #expect(segment(nil).stateLabel == .willSkip)
        // A playable break is an ordinary planned row.
        #expect(orderItem("s", .planned, kind: .segment, segmentState: .ready, playable: true).stateLabel == nil)
    }

    @Test func aSkippedBreakIsQuieterThanASkippedRecord() {
        #expect(orderItem("b", .skipped, kind: .segment).opacity == 0.25)
        #expect(orderItem("b", .skipped).opacity == 0.5)
        #expect(orderItem("b", .planned).opacity == 1)
    }
}
