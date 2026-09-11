/// How long to wait before trying the stream again.
///
/// Doubling from a second to half a minute. A stream that failed once may be a passing thing (a
/// segment that rolled off, a proxy restarting) and retrying at once is right for that; one that
/// has failed six times is a station that is down, and a phone retrying every second is a phone
/// flattening its own battery against a server that is not there.
///
/// It gives up eventually rather than retrying for the rest of the day, because a listener who
/// walked away from a stopped stream should not come back to a dead battery.
public struct Backoff: Sendable {
    public let first: Duration
    public let ceiling: Duration
    public let giveUpAfter: Duration

    private var attempts = 0
    private var waited: Duration = .zero

    public init(first: Duration = .seconds(1), ceiling: Duration = .seconds(30), giveUpAfter: Duration = .seconds(300)) {
        self.first = first
        self.ceiling = ceiling
        self.giveUpAfter = giveUpAfter
    }

    /// The next wait, or `nil` once this has been trying for longer than it is worth.
    public mutating func next() -> Duration? {
        if exhausted { return nil }
        let wait = min(first * (1 << min(attempts, 5)), ceiling)
        attempts += 1
        waited += wait
        return wait
    }

    /// Called when the stream plays again, so the next failure starts from a second and not from thirty.
    public mutating func reset() {
        attempts = 0
        waited = .zero
    }

    /// Whether this has been trying for longer than it is worth, i.e. `next()` would answer `nil`.
    public var exhausted: Bool { waited >= giveUpAfter }
}
