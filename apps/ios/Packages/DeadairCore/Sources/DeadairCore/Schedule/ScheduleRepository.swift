import DeadairSdk
import Foundation
import Observation

/// One reading of the schedule: the clock and the blocks, and the names that make them readable.
public struct ScheduleReading: Equatable, Sendable {
    public let now: ScheduleNow
    public let slots: [ScheduleSlot]
    public let personas: [Persona]
}

/// What the station is scheduled to be doing, polled.
///
/// **Three reads, two cadences.** `/schedule/current` is the clock and the blocks and moves every
/// half minute, which is what the console polls it at. The slot list and the persona list turn a
/// block id into a name and a host, and change when an operator edits the schedule, which is almost
/// never; so they are read when the screen opens and again only once half an hour of polls have
/// gone by, rather than three requests a minute for an answer that has not moved.
///
/// `apps/android`'s `ScheduleRepository`, on the lease-driven `Poller`, so nothing is asked while
/// nobody is looking.
@MainActor
@Observable
public final class ScheduleRepository {
    public static let schedule = PollSchedule(steady: .seconds(30), ceiling: .seconds(300))
    /// How many polls the slot and persona lists are good for: half an hour of them.
    public static let namesEveryPolls = 60

    @ObservationIgnored private var poller: Poller<ScheduleReading>!
    @ObservationIgnored private let readCurrent: @Sendable () async throws -> ScheduleNow
    @ObservationIgnored private let readSlots: @Sendable () async throws -> [ScheduleSlot]
    @ObservationIgnored private let readPersonas: @Sendable () async throws -> [Persona]
    @ObservationIgnored private var polls = 0
    /// The poll the names were last read on, or `nil` when they have never been read successfully.
    @ObservationIgnored private var namesReadAt: Int?
    @ObservationIgnored private var slots: [ScheduleSlot] = []
    @ObservationIgnored private var personas: [Persona] = []

    public init(
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
        readCurrent: @escaping @Sendable () async throws -> ScheduleNow,
        readSlots: @escaping @Sendable () async throws -> [ScheduleSlot],
        readPersonas: @escaping @Sendable () async throws -> [Persona]
    ) {
        self.readCurrent = readCurrent
        self.readSlots = readSlots
        self.readPersonas = readPersonas
        poller = Poller(schedule: Self.schedule, sleep: sleep, now: now) { [weak self] in
            guard let self else { throw Gone() }
            return try await self.read()
        }
    }

    public var state: PollState<ScheduleReading> { poller.state }

    public func subscribe() -> PollLease { poller.subscribe() }

    /// Hold a lease for as long as the calling task runs.
    public func hold() async { await poller.hold() }

    /// Ask again now, and forget the backoff.
    public func retry() { poller.kick() }

    /// Throw away what is known, for a new session or a new station.
    public func reset() {
        polls = 0
        namesReadAt = nil
        slots = []
        personas = []
        poller.restart()
    }

    private func read() async throws -> ScheduleReading {
        defer { polls += 1 }
        // The names first, and only when they are stale: a block with no label is a worse answer
        // than a block a moment late. "Stale" includes never read, so a first read that failed is
        // tried again on the next poll rather than half an hour later.
        if namesReadAt.map({ polls - $0 >= Self.namesEveryPolls }) ?? true {
            slots = try await readSlots()
            personas = try await readPersonas()
            namesReadAt = polls
        }
        return ScheduleReading(now: try await readCurrent(), slots: slots, personas: personas)
    }

    private struct Gone: Error {}
}
