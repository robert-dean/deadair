import DeadairSdk

/// How far through the record on air, for a progress bar.
public struct Playhead: Equatable, Sendable {
    public let elapsedMs: Int
    public let remainingMs: Int
    public let durationMs: Int

    public var fraction: Double {
        durationMs <= 0 ? 0 : Double(elapsedMs) / Double(durationMs)
    }

    /// The playhead, projected between readings.
    ///
    /// The station answers with the DECODER's own countdown taken at the moment it was read, and
    /// this app polls every few seconds. Showing that raw gives a clock that jumps; projecting from
    /// it gives one that moves and RE-ANCHORS on every reading rather than drifting away from the
    /// station. It is the projection the console and the Android app do, for the same reason.
    ///
    /// `nil` when there is nothing to measure: no track, no reported duration, or a decoder that
    /// could not say how much is left. **It never extrapolates from `startedAt` alone.** A clock
    /// built from a start time and the wall clock would keep moving confidently while being wrong,
    /// and a transport that lies smoothly is worse than one that admits it does not know:
    /// `remainingMs` already leads the listener by the encoder and client buffers, and `startedAt`
    /// is when the PLAYER reported the track began, not when this listener heard it.
    public static func project(_ track: NowPlayingTrack?, readAt: ContinuousClock.Instant, now: ContinuousClock.Instant) -> Playhead? {
        guard let track, let duration = track.durationMs, let reported = track.remainingMs, duration > 0 else { return nil }

        // Clamped at both ends. A late reading leaves more time carried than was left, and a clock
        // that ran past the end of the record would read as a fault; a clock that ran backwards
        // would claim more left than the record is long.
        let carried = max(0, milliseconds(readAt.duration(to: now)))
        let remaining = min(max(reported - carried, 0), duration)
        return Playhead(elapsedMs: duration - remaining, remainingMs: remaining, durationMs: duration)
    }

    private static func milliseconds(_ duration: Duration) -> Int {
        let (seconds, attoseconds) = duration.components
        return Int(seconds) * 1000 + Int(attoseconds / 1_000_000_000_000_000)
    }
}

/// A length of a record as a clock reads it: `3:58`, and `1:02:10` past an hour.
///
/// Seconds, because this is the one place in the app that counts them: the bar re-anchors every
/// few seconds and ticks between, so a label under it can honestly move once a second. Figures,
/// not words, so it is the same in every language this app will speak.
public func clockOf(_ ms: Int) -> String {
    let total = max(ms / 1000, 0)
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let seconds = total % 60
    let paddedSeconds = seconds < 10 ? "0\(seconds)" : "\(seconds)"
    if hours > 0 {
        let paddedMinutes = minutes < 10 ? "0\(minutes)" : "\(minutes)"
        return "\(hours):\(paddedMinutes):\(paddedSeconds)"
    }
    return "\(minutes):\(paddedSeconds)"
}
