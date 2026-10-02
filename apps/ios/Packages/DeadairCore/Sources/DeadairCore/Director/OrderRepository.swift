import DeadairSdk
import Foundation
import Observation

/// One reading of the running order, and the personas that name who is presenting it.
public struct OrderReading: Equatable, Sendable {
    public let order: StationOrder
    /// `nil` until the list has been read once: not knowing who is presenting is a different thing
    /// from the station having nobody, and the header says different things for the two.
    public let personas: [Persona]?
}

/// The running order, as the Up next tab draws it.
public enum OrderState: Equatable, Sendable {
    /// Not an error: the order is the station's to give a signed-in account.
    case signedOut
    case loading
    case unreachable
    case loaded(OrderReading, stale: Bool)
}

/// The station's running order, polled while the Up next tab is up.
///
/// **Five seconds, the console's own cadence.** The order moves at the pace of records, and a
/// boundary is the only thing that changes it on its own. The persona list names the host and
/// changes when an operator edits a persona, which is almost never, so it is read with the first
/// order and again only every five minutes of polls.
///
/// **An action answers with the order it produced**, and `apply` puts that on screen at once rather
/// than waiting for the next poll to say the same thing; the next good poll replaces it.
///
/// `apps/android`'s `OrderRepository`, on the lease-driven `Poller`, so nothing is asked while
/// nobody is looking.
@MainActor
@Observable
public final class OrderRepository {
    public static let schedule = PollSchedule(steady: .seconds(5), ceiling: .seconds(60))
    /// How many polls the persona list is good for: five minutes of them.
    public static let personasEveryPolls = 60

    /// An order an action answered with, shown until the next poll answers.
    public private(set) var applied: StationOrder?

    @ObservationIgnored private var poller: Poller<OrderReading>!
    @ObservationIgnored private let readOrder: @Sendable () async throws -> StationOrder
    @ObservationIgnored private let readPersonas: @Sendable () async throws -> [Persona]
    @ObservationIgnored private var polls = 0
    @ObservationIgnored private var personasReadAt: Int?
    @ObservationIgnored private var personas: [Persona]?

    public init(
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
        readOrder: @escaping @Sendable () async throws -> StationOrder,
        readPersonas: @escaping @Sendable () async throws -> [Persona]
    ) {
        self.readOrder = readOrder
        self.readPersonas = readPersonas
        poller = Poller(schedule: Self.schedule, sleep: sleep, now: now) { [weak self] in
            guard let self else { throw Gone() }
            return try await self.read()
        }
    }

    /// The order, as the tab draws it. Signed out beats whatever the poll holds.
    public func state(signedIn: Bool) -> OrderState {
        guard signedIn else { return .signedOut }
        switch poller.state {
        case .loading: return .loading
        case .unreachable(lastGood: nil): return .unreachable
        case .answered(let reading), .unreachable(lastGood: let reading?):
            let shown = applied.map { OrderReading(order: $0, personas: reading.value.personas) } ?? reading.value
            return .loaded(shown, stale: poller.state.isStale)
        }
    }

    public func subscribe() -> PollLease { poller.subscribe() }

    /// Hold a lease for as long as the calling task runs.
    public func hold() async { await poller.hold() }

    /// Ask again now, and forget the backoff.
    public func retry() { poller.kick() }

    /// Show the order an action answered with, until the next poll.
    public func apply(_ order: StationOrder) {
        applied = order
    }

    /// Throw away what is known, for a new session or a new station.
    public func reset() {
        polls = 0
        personasReadAt = nil
        personas = nil
        applied = nil
        poller.restart()
    }

    private func read() async throws -> OrderReading {
        defer { polls += 1 }
        // The names are a nicety and the order is the point, so a failed persona read is not a
        // failed poll: the header waits a poll for its name rather than the list going stale.
        if personasReadAt.map({ polls - $0 >= Self.personasEveryPolls }) ?? true {
            if let read = try? await readPersonas() {
                personas = read
                personasReadAt = polls
            }
        }
        let order = try await readOrder()
        applied = nil
        return OrderReading(order: order, personas: personas)
    }

    private struct Gone: Error {}
}
