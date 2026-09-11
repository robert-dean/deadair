import Foundation
import Observation

/// One answer, and when it arrived.
///
/// The instant is from the continuous clock rather than the wall clock, so a clock correction
/// between two readings cannot make anything computed from them jump.
public struct Reading<Value: Sendable>: Sendable {
    public let value: Value
    public let readAt: ContinuousClock.Instant

    public init(_ value: Value, readAt: ContinuousClock.Instant) {
        self.value = value
        self.readAt = readAt
    }
}

extension Reading: Equatable where Value: Equatable {}

/// What a poll knows right now.
public enum PollState<Value: Sendable>: Sendable {
    /// Before the first answer. Not an error, and not "off air" either.
    case loading
    case answered(Reading<Value>)
    /// The last attempt failed, carrying the last good reading with it.
    ///
    /// Kept rather than discarded because a poll that fails once is ordinary (a phone changing
    /// network, a tunnel reconnecting), and blanking the screen for it would make every hiccup
    /// look like the station going away. What is showing is stale and the UI says so.
    case unreachable(lastGood: Reading<Value>?)

    /// The newest good reading, fresh or stale.
    public var latest: Reading<Value>? {
        switch self {
        case .loading: nil
        case .answered(let reading): reading
        case .unreachable(let lastGood): lastGood
        }
    }

    public var isStale: Bool {
        if case .unreachable(let lastGood) = self { return lastGood != nil }
        return false
    }
}

extension PollState: Equatable where Value: Equatable {}

/// One question, asked on an interval, for as long as somebody holds a lease on the answer.
///
/// **The lease is the point.** Nothing polls because a repository exists; it polls because a
/// screen or the player took a lease, and it stops when the last one is released. That is what
/// makes "a stopped app in the background makes no requests at all" a property of this type
/// rather than a discipline every caller has to remember, and it matters more here than it
/// usually would: a request is a line in the station's log as well as battery. A short grace after
/// the last lease means handing over from the screen to the player does not tear the loop down and
/// build it again. It is the desktop app's `Poller` and Android's `stateIn(WhileSubscribed)`.
///
/// **Failure widens the interval rather than stopping the loop.** A station that is down comes
/// back, and a client that gave up would need somebody to notice and press something; one that
/// asked every three seconds for an hour is a client making an outage worse.
@MainActor
@Observable
public final class Poller<Value: Sendable> {
    public private(set) var state: PollState<Value> = .loading

    @ObservationIgnored private let read: @Sendable () async throws -> Value
    @ObservationIgnored private let schedule: PollSchedule
    @ObservationIgnored private let grace: Duration
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private let now: @Sendable () -> ContinuousClock.Instant

    @ObservationIgnored private var leases = 0
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var waiting: Task<Void, Error>?
    @ObservationIgnored private var teardown: Task<Void, Never>?
    @ObservationIgnored private var kicked = false

    public init(
        schedule: PollSchedule,
        grace: Duration = .seconds(5),
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
        read: @escaping @Sendable () async throws -> Value
    ) {
        self.schedule = schedule
        self.grace = grace
        self.sleep = sleep
        self.now = now
        self.read = read
    }

    /// Start asking, if nothing is already, and keep asking until the lease is released.
    public func subscribe() -> PollLease {
        leases += 1
        // A lease taken back inside the grace period cancels the teardown rather than restarting
        // the loop, so the reading survives a hand-over.
        teardown?.cancel()
        teardown = nil
        if loop == nil { start() }
        return PollLease { [weak self] in self?.release() }
    }

    /// Hold a lease for as long as the calling task runs: what a SwiftUI `.task` wants, since
    /// the view's task is cancelled when the view goes away and the lease goes with it.
    public func hold() async {
        let lease = subscribe()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3600))
        }
        lease.release()
    }

    /// Ask now rather than at the next interval, and forget the backoff: what a Retry button and
    /// a pull to refresh both mean. A kick that lands mid-request is kept until the loop next
    /// waits, so a retry pressed during a slow request is not lost.
    public func kick() {
        kicked = true
        waiting?.cancel()
    }

    /// Throw away what is known and start again, for a question whose subject has changed: a
    /// different station is not a stale reading of the old one.
    public func restart() {
        loop?.cancel()
        loop = nil
        waiting?.cancel()
        state = .loading
        if leases > 0 { start() }
    }

    private func start() {
        loop = Task { [weak self] in await self?.run() }
    }

    private func run() async {
        var failures = 0
        while !Task.isCancelled {
            do {
                let value = try await read()
                if Task.isCancelled { return }
                state = .answered(Reading(value, readAt: now()))
                failures = 0
            } catch {
                if Task.isCancelled { return }
                failures += 1
                state = .unreachable(lastGood: state.latest)
            }

            if !kicked {
                let waiter = Task { [sleep, interval = schedule.interval(afterFailures: failures)] in try await sleep(interval) }
                waiting = waiter
                _ = try? await waiter.value
                waiting = nil
            }
            if Task.isCancelled { return }
            if kicked {
                kicked = false
                failures = 0
            }
        }
    }

    private func release() {
        leases -= 1
        guard leases == 0 else { return }
        teardown = Task { [weak self, sleep, grace] in
            do {
                try await sleep(grace)
            } catch {
                // Somebody took a lease again inside the grace period.
                return
            }
            self?.stopIfUnleased()
        }
    }

    private func stopIfUnleased() {
        guard leases == 0 else { return }
        loop?.cancel()
        loop = nil
        waiting?.cancel()
        teardown = nil
    }
}

/// How long a poll waits between questions.
///
/// Steady while it is working, doubling while it is not, up to a ceiling. A kick resets it.
public struct PollSchedule: Equatable, Sendable {
    public let steady: Duration
    public let ceiling: Duration

    public init(steady: Duration, ceiling: Duration) {
        self.steady = steady
        self.ceiling = ceiling
    }

    public func interval(afterFailures failures: Int) -> Duration {
        guard failures > 0 else { return steady }
        let backed = steady * (1 << min(failures, 5))
        return min(backed, ceiling)
    }
}

/// Held for as long as the answer is wanted. Releasing it twice is harmless.
public final class PollLease: Sendable {
    private let released: OnceFlag
    private let onRelease: @MainActor @Sendable () -> Void

    init(_ onRelease: @escaping @MainActor @Sendable () -> Void) {
        self.onRelease = onRelease
        self.released = OnceFlag()
    }

    @MainActor
    public func release() {
        if released.claim() { onRelease() }
    }
}

/// A one-way flag, set once from whichever thread gets there first.
final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.withLock {
            if done { return false }
            done = true
            return true
        }
    }
}
