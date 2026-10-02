@testable import DeadairCore
import DeadairSdk
import Testing

/// Where a move may land: never below the first planned row, and never where the row already is.
/// `apps/android`'s `MoveTargetTest`.
struct MoveTargetTests {
    // Ten rows; the first three are spent, so planned rows start at 3.
    private let first = 3
    private let size = 10

    @Test func playNextLandsOnTheFirstPlannedRow() {
        #expect(moveTarget(.playNext, position: 7, firstPlannedIndex: first, size: size) == 3)
    }

    @Test func playNextIsNoMoveForTheRowAlreadyAtTheFront() {
        #expect(moveTarget(.playNext, position: 3, firstPlannedIndex: first, size: size) == nil)
    }

    @Test func upAndDownStepByOneAndStopAtTheEdges() {
        #expect(moveTarget(.up, position: 7, firstPlannedIndex: first, size: size) == 6)
        #expect(moveTarget(.down, position: 7, firstPlannedIndex: first, size: size) == 8)
        // Up from the front would land inside what the player holds.
        #expect(moveTarget(.up, position: 3, firstPlannedIndex: first, size: size) == nil)
        #expect(moveTarget(.down, position: 9, firstPlannedIndex: first, size: size) == nil)
    }

    @Test func aSpentRowOrAnOrderWithNothingPlannedHasNoMoves() {
        #expect(moveTarget(.down, position: 1, firstPlannedIndex: first, size: size) == nil)
        #expect(moveTarget(.playNext, position: 1, firstPlannedIndex: nil, size: size) == nil)
    }
}

/// Where a dragged row may land, and how the list looks when it does. `apps/android`'s `DragReorderTest`,
/// with SwiftUI's drop offsets on top.
struct DragReorderTests {
    // Two played, one on air, one handed over, three planned.
    private let items = [
        orderItem("a", .played), orderItem("b", .played), orderItem("c", .airing), orderItem("d", .handed),
        orderItem("e", .planned), orderItem("f", .planned), orderItem("g", .planned),
    ]

    @Test func aRowMovedDownLandsAfterTheRowsItPassed() {
        #expect(["a", "b", "c", "d"].moved(from: 1, to: 3) == ["a", "c", "d", "b"])
    }

    @Test func aRowMovedUpLandsBeforeTheRowsItPassed() {
        #expect(["a", "b", "c", "d"].moved(from: 3, to: 0) == ["d", "a", "b", "c"])
    }

    @Test func aMoveToWhereItIsOrOffTheEndChangesNothing() {
        #expect(["a", "b"].moved(from: 1, to: 1) == ["a", "b"])
        #expect(["a", "b"].moved(from: 1, to: 5) == ["a", "b"])
    }

    @Test func aDragLandsAmongThePlannedRowsAndNeverAmongWhatThePlayerHolds() {
        // History folded: the shown rows start at the one on air, so the planned ones are 2 to 4.
        #expect(RunningOrderUiState(items: items).dragBounds == 2...4)
    }

    @Test func theBoundsFollowTheFoldWhenTheHistoryIsOpen() {
        #expect(RunningOrderUiState(items: items, historyOpen: true).dragBounds == 4...6)
    }

    @Test func oneRowPlannedHasNowhereToGo() {
        let one = [orderItem("a", .airing), orderItem("b", .planned)]
        #expect(RunningOrderUiState(items: one).dragBounds == nil)
    }

    @Test func aDropIsStatedAgainstTheWholeOrderAndSwiftUIsOffsetIsOneBelowWhereARowDraggedDownLands() {
        let ui = RunningOrderUiState(items: items)
        // Shown: c d e f g. Dragging e (shown 2) to after g reports offset 5 and lands at shown 4: whole index 6.
        #expect(ui.dropTarget(from: 2, offset: 5) == 6)
        // Dragging g (shown 4) up before e reports offset 2 and lands at shown 2: whole index 4.
        #expect(ui.dropTarget(from: 4, offset: 2) == 4)
    }

    @Test func aDropAmongWhatThePlayerHoldsOrOfASpentRowOrNowhereIsRefused() {
        let ui = RunningOrderUiState(items: items)
        #expect(ui.dropTarget(from: 4, offset: 0) == nil)
        #expect(ui.dropTarget(from: 1, offset: 4) == nil)
        #expect(ui.dropTarget(from: 3, offset: 3) == nil)
        #expect(ui.dropTarget(from: 3, offset: 4) == nil)
    }
}
