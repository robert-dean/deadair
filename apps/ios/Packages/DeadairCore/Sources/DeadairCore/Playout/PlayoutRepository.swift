import DeadairSdk
import Foundation
import Observation

/// The transport reading, as the operator's controls draw it.
public enum PlayoutState: Equatable, Sendable {
    case signedOut
    case loading
    /// The status has never arrived, so there is nothing to show as stale.
    case unreachable
    /// `air` is absent until the slower poll has answered once, which is a moment after the first.
    case loaded(status: PlayoutStatus, air: StationAir?, stale: Bool)

    public var status: PlayoutStatus? {
        if case .loaded(let status, _, _) = self { return status }
        return nil
    }

    public var air: StationAir? {
        if case .loaded(_, let air, _) = self { return air }
        return nil
    }
}

/// What the station's playout is doing and who is driving it, polled while somebody is looking.
///
/// **Two clocks.** Status every two seconds and air every five, which are the console's own
/// cadences: the first is what an operator watches change under their hand, and the second changes
/// only when somebody changes it. Both stop within seconds of the last screen letting go, because a
/// signed-in listener who has switched tabs is not an operator watching a desk, and two polls a
/// second per phone is a real cost to a station on a home connection.
///
/// **`apply` and `refetchSoon`.** Every operator action answers with the status it produced, and
/// that answer goes on screen at once rather than waiting up to two seconds for the poll to agree.
/// The follow-up reads at 400 ms, 1 s and 2.5 s are what the console does after every action too:
/// the answer to "skip" is the status the instant after the skip, and the record changing at the
/// encoder is a second or two behind it. `apps/android`'s `PlayoutRepository`.
@MainActor
@Observable
public final class PlayoutRepository {
    public static let statusSchedule = PollSchedule(steady: .seconds(2), ceiling: .seconds(60))
    public static let airSchedule = PollSchedule(steady: .seconds(5), ceiling: .seconds(60))
    /// When to look again after an action: the console's own three follow-ups.
    public static let followUps: [Duration] = [.milliseconds(400), .seconds(1), .milliseconds(2500)]

    /// A status an action just answered with, shown until the poll next answers.
    public private(set) var applied: PlayoutStatus?
    public private(set) var appliedAir: StationAir?

    @ObservationIgnored private var status: Poller<PlayoutStatus>!
    @ObservationIgnored private var air: Poller<StationAir>!
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void

    public init(
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
        readStatus: @escaping @Sendable () async throws -> PlayoutStatus,
        readAir: @escaping @Sendable () async throws -> StationAir
    ) {
        self.sleep = sleep
        // A fresh poll supersedes whatever an action put up.
        status = Poller(schedule: Self.statusSchedule, sleep: sleep, now: now) { [weak self] in
            let answer = try await readStatus()
            await self?.clearApplied()
            return answer
        }
        air = Poller(schedule: Self.airSchedule, sleep: sleep, now: now) { [weak self] in
            let answer = try await readAir()
            await self?.clearAppliedAir()
            return answer
        }
    }

    public func state(signedIn: Bool) -> PlayoutState {
        guard signedIn else { return .signedOut }
        guard let shown = applied ?? status.state.latest?.value else {
            if case .unreachable = status.state { return .unreachable }
            return .loading
        }
        return .loaded(status: shown, air: appliedAir ?? air.state.latest?.value, stale: status.state.isStale)
    }

    /// Hold both polls for as long as the calling task runs.
    public func hold() async {
        let statusLease = status.subscribe()
        let airLease = air.subscribe()
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3600))
        }
        statusLease.release()
        airLease.release()
    }

    /// Ask again now and forget the backoff.
    public func retry() {
        status.kick()
        air.kick()
    }

    /// Put an action's answer on screen now rather than in up to two seconds.
    public func apply(_ answer: PlayoutStatus) {
        applied = answer
    }

    public func applyAir(_ answer: StationAir) {
        appliedAir = answer
    }

    /// Read again a few times over the next seconds, which is when an action's effect lands at the
    /// encoder. Each delay is measured from now, not from the read before it.
    public func refetchSoon(_ delays: [Duration] = PlayoutRepository.followUps) {
        for delay in delays {
            Task { [weak self, sleep] in
                try? await sleep(delay)
                self?.retry()
            }
        }
    }

    /// Throw away what is known, for a new session or a new station.
    public func reset() {
        applied = nil
        appliedAir = nil
        status.restart()
        air.restart()
    }

    private func clearApplied() { applied = nil }

    private func clearAppliedAir() { appliedAir = nil }
}
