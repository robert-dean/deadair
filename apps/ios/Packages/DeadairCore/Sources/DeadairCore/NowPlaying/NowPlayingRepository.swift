import DeadairSdk
import Foundation
import Observation

/// What the station is playing, polled.
///
/// A poll and not a push, because the API offers nothing else: there is no SSE and no WebSocket
/// anywhere in it, and `/nowplaying` answers out of memory with no database work, so being asked
/// every few seconds costs the station nothing.
///
/// **The polling stops on its own when nobody is looking.** It runs only while something holds a
/// lease (the screen while it is visible, the player while it wants audio), so an app in the
/// background with the player stopped makes no requests at all.
@MainActor
@Observable
public final class NowPlayingRepository {
    /// Fast enough that a track change is noticed within a bar or two, which is what the console
    /// uses; half a minute at most while the station is not answering.
    public static let schedule = PollSchedule(steady: .seconds(3), ceiling: .seconds(30))

    /// The station being asked. Changing it throws the old reading away, because a different
    /// station is not a stale reading of the old one; changing the FORMAT does not come here at
    /// all, so a format change never costs a good reading.
    public private(set) var station: StationUrl?

    @ObservationIgnored private var poller: Poller<NowPlaying>!

    /// `fetch` is one ask of one station. A function rather than the SDK itself, because what this
    /// type is FOR is the policy (how often, what to do when it fails, when to stop) and none of
    /// that needs an HTTP client to be exercised.
    public init(
        station: StationUrl?,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) },
        now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
        fetch: @escaping @Sendable (StationUrl) async throws -> NowPlaying
    ) {
        self.station = station
        poller = Poller(schedule: Self.schedule, sleep: sleep, now: now) { [weak self] in
            guard let station = await self?.station else { throw NoStation() }
            return try await fetch(station)
        }
    }

    public var state: NowPlayingState {
        station == nil ? .loading : poller.state
    }

    public func point(at station: StationUrl?) {
        guard station != self.station else { return }
        self.station = station
        poller.restart()
    }

    public func subscribe() -> PollLease { poller.subscribe() }

    /// Hold a lease for as long as the calling task runs.
    public func hold() async { await poller.hold() }

    /// Ask again now, and forget the backoff. What a Retry button means.
    public func retry() { poller.kick() }

    private struct NoStation: Error {}
}
