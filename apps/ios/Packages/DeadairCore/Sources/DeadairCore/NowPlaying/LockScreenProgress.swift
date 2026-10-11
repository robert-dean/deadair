import DeadairSdk

/// How far through the record the listener is, as the lock screen's bar shows it.
///
/// The system is given an elapsed time, a duration and a rate, and runs the bar on from there by
/// itself. So this is published when something the system cannot work out for itself moves (a new
/// record, a bar appearing or going, a stop or a start), and not on every poll.
public struct LockScreenProgress: Equatable, Sendable {
    public let elapsedMs: Int
    public let durationMs: Int

    public init(elapsedMs: Int, durationMs: Int) {
        self.elapsedMs = elapsedMs
        self.durationMs = durationMs
    }

    public var elapsedSeconds: Double { Double(elapsedMs) / 1000 }
    public var durationSeconds: Double { Double(durationMs) / 1000 }

    /// The bar for the reading the listener is HEARING, or `nil` for none.
    ///
    /// `heard` is `NowPlayingGate`'s release (`Listening.aired`), stamped for the listener's ears, so
    /// the bar matches Now playing's and changes when the music does; the poll's own stamp would run
    /// a buffer ahead. `nil` for a break: the station talking between two records has a length, but
    /// a bar under the host's name reads as a record's progress and is not one. `nil` as well for
    /// anything `Playhead.project` cannot measure, because a bar that lies smoothly is worse than
    /// none. Without a bar the lock screen keeps saying what it always has: a live stream.
    public static func of(_ heard: Reading<NowPlaying>?, now: ContinuousClock.Instant) -> LockScreenProgress? {
        guard let heard, let track = heard.value.track, track.kind != .break else { return nil }
        guard let head = Playhead.project(track, readAt: heard.readAt, now: now) else { return nil }
        return LockScreenProgress(elapsedMs: head.elapsedMs, durationMs: head.durationMs)
    }
}

/// What the lock screen was last told about progress, and so where its own bar is now.
///
/// Kept so an update is sent only when the system's extrapolation would be wrong by more than a
/// listener would notice: a reading of the same record re-anchors by a fraction of a second, while a
/// new record would leave the bar running on past the end of the old one's length.
public struct LockScreenProgressState: Sendable {
    public private(set) var shown: LockScreenProgress?
    private var shownAt: ContinuousClock.Instant?
    private var shownPlaying = false
    /// Nothing published yet, so the first answer always goes out.
    private var fresh = true

    public init() {}

    /// Where the system's bar is now, run on from what it was told at the rate it was told.
    public func extrapolated(now: ContinuousClock.Instant) -> LockScreenProgress? {
        guard let shown, let shownAt else { return nil }
        guard shownPlaying else { return shown }
        let (seconds, attoseconds) = shownAt.duration(to: now).components
        let carried = Int(seconds) * 1000 + Int(attoseconds / 1_000_000_000_000_000)
        return LockScreenProgress(elapsedMs: min(max(shown.elapsedMs + carried, 0), shown.durationMs), durationMs: shown.durationMs)
    }

    /// Whether `next` has to be published, because the system's own bar would not get there.
    public func needsUpdate(to next: LockScreenProgress?, playing: Bool, now: ContinuousClock.Instant, toleranceMs: Int = 1000) -> Bool {
        if fresh || playing != shownPlaying { return true }
        let current = extrapolated(now: now)
        guard let current, let next else { return (current == nil) != (next == nil) }
        if current.durationMs != next.durationMs { return true }
        return abs(current.elapsedMs - next.elapsedMs) > toleranceMs
    }

    /// `progress` was handed to the system, playing or not, at `now`.
    public mutating func record(_ progress: LockScreenProgress?, playing: Bool, at now: ContinuousClock.Instant) {
        shown = progress
        shownAt = now
        shownPlaying = playing
        fresh = false
    }

    /// The tile is gone; whatever comes next is published whatever it says.
    public mutating func reset() {
        self = LockScreenProgressState()
    }
}
