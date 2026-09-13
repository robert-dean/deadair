import DeadairSdk

/// A block, as a card shows it.
public struct BlockCard: Equatable, Sendable {
    /// The station's own label, or `untitled` for a slot that has none.
    public let label: Message
    /// The block's hours, with the weekday when it is not the station's own today. Absent for a
    /// stamp that cannot be read.
    public let hours: BlockHours?
    public let host: String?
    public let brief: String?
}

/// The first cell: either the block on now, or the hours no block claims.
public enum OnNow: Equatable, Sendable {
    /// `eyebrow` is `onAir`, or `dueNow` while the station is doing something else.
    case live(block: BlockCard, eyebrow: Message, left: Message, progress: Double, takenOver: Bool)
    case between(detail: Message)
}

/// A block that has not started yet.
public struct Ahead: Equatable, Sendable {
    public let eyebrow: Message
    public let startsIn: Message
    public let block: BlockCard
}

public struct WhatsOnUiState: Equatable, Sendable {
    public let onNow: OnNow
    public let ahead: [Ahead]
}

/// What is on, what is next, and what is after that.
///
/// **Every fact here comes from the station.** The blocks and the clock both arrive in one
/// `GET /schedule/current`, and this phone does not know the station's timezone and must not derive
/// a station-local date. What is left for a client is one subtraction between two readings taken in
/// the same answer, which is why `now` rides along beside them. There is deliberately no local
/// timer: the reading moves when the poll moves.
///
/// **The block on now is not always the one airing.** An operator's own choice holds until the
/// next slot BEGINS, so the schedule can want something the station is not doing, and the eyebrow
/// reads "Due now" rather than "On air" rather than tell a listener a show is on while they are
/// plainly hearing something else.
///
/// `apps/android`'s `whatsOn`, line for line, and its tests are the same cases.
public func whatsOn(_ current: ScheduleNow, slots: [ScheduleSlot], personas: [Persona]) -> WhatsOnUiState {
    let blocks = current.upcoming

    // Covering `now` is what makes the first block the one ON now rather than the next one. Both
    // are fixed-width readings of one clock, so comparing the stamps is the whole test.
    let first = blocks.first
    let live = first.flatMap { $0.start <= current.now ? $0 : nil }
    let upcoming = Array((live == nil ? blocks : Array(blocks.dropFirst())).prefix(2))

    // Absent counts, and is the commonest form of it: a station put on by hand before there was a
    // schedule belongs to no slot at all.
    let takenOver = current.slotId != nil && current.slotId != current.airingSlotId

    let onNow: OnNow
    if let live {
        let total = minutesBetween(live.start, live.end)
        let gone = minutesBetween(live.start, current.now)
        onNow = .live(
            block: cardFor(live, now: current.now, slots: slots, personas: personas),
            eyebrow: takenOver ? .dueNow : .onAir,
            left: .left(spanOf(total - gone)),
            // A block with no length cannot be part-way through one, so it reads as not started
            // rather than as finished: the bar is the honest shape of "nothing to report".
            progress: total <= 0 ? 0 : min(max(Double(gone) / Double(total), 0), 1),
            takenOver: takenOver
        )
    } else if let first {
        onNow = .between(detail: .sustainingFor(spanOf(minutesBetween(current.now, first.start))))
    } else {
        onNow = .between(detail: .noBlockDue)
    }

    return WhatsOnUiState(
        onNow: onNow,
        ahead: upcoming.enumerated().map { index, block in
            Ahead(
                eyebrow: index == 0 ? .upNext : .afterThat,
                startsIn: .startsIn(spanOf(minutesBetween(current.now, block.start))),
                block: cardFor(block, now: current.now, slots: slots, personas: personas)
            )
        }
    )
}

private func cardFor(_ block: ScheduleOccurrence, now: String, slots: [ScheduleSlot], personas: [Persona]) -> BlockCard {
    let slot = slots.first { $0.id == block.slotId }
    let host = slot?.personaId.flatMap { id in personas.first { $0.id == id } }
    return BlockCard(
        // A slot may genuinely be unnamed, and an empty heading is worse than an honest placeholder.
        label: nonBlank(block.label).map(Message.text) ?? .untitled,
        hours: hoursOf(start: block.start, end: block.end, now: now),
        // The name they are introduced by, falling back to the one the operator filed them under:
        // a listener knows the voice rather than the persona.
        host: host.map { nonBlank($0.djName) ?? $0.label },
        brief: nonBlank(slot?.brief)
    )
}
