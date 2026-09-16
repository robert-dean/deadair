@testable import DeadairCore
import DeadairSdk
import Testing

/// What the What's on screen says. `WhatsOnUiStateTest.kt`, case for case.
///
/// Which block is ON and which is merely NEXT is one string comparison, and getting it backwards
/// would show a listener a show that has not started as the one they are hearing. The takeover
/// wording is the other half: an operator's own choice holds until the next slot begins, so the
/// schedule can want something the station is not doing, and the eyebrow is where that is said.
struct WhatsOnUiStateTests {
    private let now = "2026-09-06 20:30:00"

    private func block(_ slotId: String, _ label: String, _ start: String, _ end: String) -> ScheduleOccurrence {
        ScheduleOccurrence(slotId: slotId, label: label, start: start, end: end)
    }

    private func slot(_ id: String, personaId: String? = nil, brief: String? = nil) -> ScheduleSlot {
        ScheduleSlot(id: id, label: "Slot \(id)", startsAtMinutes: 0, endsAtMinutes: 60, personaId: personaId, brief: brief, mode: .rotation, onEnd: .extend)
    }

    private func persona(_ id: String, label: String, djName: String? = nil) -> Persona {
        Persona(id: id, key: "key-\(id)", label: label, style: "warm", djName: djName, defaultHost: true, presenting: true)
    }

    private var evening: ScheduleOccurrence { block("slot-1", "Late Night", "2026-09-06 20:00:00", "2026-09-06 22:00:00") }
    private var next: ScheduleOccurrence { block("slot-2", "Small Hours", "2026-09-06 22:00:00", "2026-09-07 00:00:00") }
    private var after: ScheduleOccurrence { block("slot-3", "Dawn", "2026-09-07 06:00:00", "2026-09-07 08:00:00") }

    private func live(_ state: WhatsOnUiState) -> (block: BlockCard, eyebrow: Message, left: Message, progress: Double, takenOver: Bool)? {
        if case let .live(block, eyebrow, left, progress, takenOver) = state.onNow { return (block, eyebrow, left, progress, takenOver) }
        return nil
    }

    @Test func theFirstBlockIsOnAirOnlyOnceItHasStarted() throws {
        let state = whatsOn(ScheduleNow(now: now, slotId: "slot-1", airingSlotId: "slot-1", upcoming: [evening, next]), slots: [], personas: [])

        let on = try #require(live(state))
        #expect(on.eyebrow == .onAir)
        #expect(on.block.label == .text("Late Night"))
        #expect(on.left == .left(.hours(1, minutes: 30)))
        // Thirty minutes into two hours.
        #expect(abs(on.progress - 0.25) < 0.001)
    }

    @Test func aBlockThatHasNotStartedYetIsNextNotOn() {
        let state = whatsOn(ScheduleNow(now: now, upcoming: [next, after]), slots: [], personas: [])

        #expect(live(state) == nil)
        #expect(state.ahead.map(\.eyebrow) == [.upNext, .afterThat])
        #expect(state.ahead.first?.block.label == .text("Small Hours"))
        #expect(state.ahead.first?.startsIn == .startsIn(.hours(1, minutes: 30)))
    }

    @Test func saysDueNowRatherThanOnAirWhileAnOperatorHoldsTheStation() throws {
        let state = whatsOn(ScheduleNow(now: now, slotId: "slot-1", airingSlotId: "slot-9", upcoming: [evening]), slots: [], personas: [])

        let on = try #require(live(state))
        #expect(on.eyebrow == .dueNow)
        #expect(on.takenOver)
    }

    @Test func aStationPutOnByHandBelongsToNoSlotWhichIsTheCommonestTakeoverOfAll() {
        let state = whatsOn(ScheduleNow(now: now, slotId: "slot-1", upcoming: [evening]), slots: [], personas: [])

        #expect(live(state)?.takenOver == true)
    }

    @Test func aStationWithNoScheduleAtAllIsNotATakeover() {
        #expect(live(whatsOn(ScheduleNow(now: now, upcoming: [evening]), slots: [], personas: []))?.eyebrow == .onAir)
    }

    @Test func aGapSaysHowLongTheSustainingSourceHas() {
        let state = whatsOn(ScheduleNow(now: now, upcoming: [next]), slots: [], personas: [])

        #expect(state.onNow == .between(detail: .sustainingFor(.hours(1, minutes: 30))))
    }

    @Test func aStationWithNothingDueSaysSoWithoutACountdown() {
        let state = whatsOn(ScheduleNow(now: now, upcoming: []), slots: [], personas: [])

        #expect(state.onNow == .between(detail: .noBlockDue))
        #expect(state.ahead.isEmpty)
    }

    @Test func namesTheHostByTheNameTheyAreIntroducedUnder() throws {
        // Not the persona's label, which is what the operator filed them under. A listener knows
        // the voice.
        let state = whatsOn(
            ScheduleNow(now: now, upcoming: [evening]),
            slots: [slot("slot-1", personaId: "p-1", brief: "slow records")],
            personas: [persona("p-1", label: "Night persona", djName: "Cass")]
        )

        let on = try #require(live(state))
        #expect(on.block.host == "Cass")
        #expect(on.block.brief == "slow records")
        #expect(on.block.hours == BlockHours(from: Clock(hour: 20, minute: 0), to: Clock(hour: 22, minute: 0), day: nil))
    }

    @Test func fallsBackToThePersonasOwnLabelWhereThereIsNoDjName() {
        let state = whatsOn(
            ScheduleNow(now: now, upcoming: [evening]),
            slots: [slot("slot-1", personaId: "p-1")],
            personas: [persona("p-1", label: "Night persona")]
        )

        #expect(live(state)?.block.host == "Night persona")
    }

    @Test func leavesTheHostOutWhenTheSlotNamesNobody() {
        let state = whatsOn(ScheduleNow(now: now, upcoming: [evening]), slots: [slot("slot-1")], personas: [])

        #expect(live(state)?.block.host == nil)
    }

    @Test func givesAnUnnamedBlockSomethingToBeCalled() {
        let unnamed = block("slot-1", "", "2026-09-06 20:00:00", "2026-09-06 22:00:00")

        #expect(live(whatsOn(ScheduleNow(now: now, upcoming: [unnamed]), slots: [], personas: []))?.block.label == .untitled)
    }

    @Test func showsAtMostTwoBlocksAhead() {
        let morning = block("slot-4", "Morning", "2026-09-07 09:00:00", "2026-09-07 11:00:00")
        let state = whatsOn(ScheduleNow(now: now, upcoming: [evening, next, after, morning]), slots: [], personas: [])

        #expect(state.ahead.map(\.block.label) == [.text("Small Hours"), .text("Dawn")])
    }

    @Test func aBlockWithNoLengthReadsAsNotStartedRatherThanAsFinished() {
        let zero = block("slot-1", "Glitch", "2026-09-06 20:00:00", "2026-09-06 20:00:00")

        #expect(live(whatsOn(ScheduleNow(now: now, upcoming: [zero]), slots: [], personas: []))?.progress == 0)
    }

    @Test func neverFillsTheBarPastFullHoweverLateTheReadingIs() {
        let over = block("slot-1", "Overrun", "2026-09-06 18:00:00", "2026-09-06 19:00:00")

        #expect(live(whatsOn(ScheduleNow(now: now, upcoming: [over]), slots: [], personas: []))?.progress == 1)
    }
}
