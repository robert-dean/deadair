import DeadairSdk
import Observation

/// Whether the station is set to stop by itself, and when.
public enum SleepState: Equatable, Sendable {
    case off
    case until(ContinuousClock.Instant)
    /// Stops when the record on air ends; `nil` until a reading can say when that is.
    case afterRecord(ContinuousClock.Instant?)
}

/// What a listener asked the timer for.
public enum SleepRequest: Equatable, Sendable {
    case minutes(Int)
    case afterRecord
}

/// Stops the station after a while, or after the record on air, with the sound faded out first.
///
/// It STOPS, through `onFire`, which the app wires to the same stop the button uses: a paused
/// connection is still a listener, and the station would stay on air for five minutes for somebody
/// asleep. The volume is put back afterwards, because the player keeps it across a stop and the
/// next press of play would otherwise be silent.
///
/// **"After this record" waits for the listener, not the station.** A reading's `remainingMs`
/// leads what the listener hears by whatever the player has buffered, so the deadline is the
/// reading's own time plus what was left plus the buffer. It re-anchors on every reading of the
/// same record, and when the record changes before the deadline (an operator's skip, a length that
/// was wrong) the record is over and the timer fires once the buffer has drained.
///
/// `apps/android`'s `SleepTimer`, decision for decision, on the injected `Schedule` so the tests
/// move the clock by hand. While the station plays the app is alive, so an ordinary sleeping task
/// is enough; a suspended app (the stream already dropped) fires at its next resume, against a
/// connection that is already gone, and needs no background time bought for it.
@MainActor
@Observable
public final class SleepTimer {
    public static let choices = [15, 30, 45, 60]
    public static let fade: Duration = .seconds(10)

    public private(set) var state: SleepState = .off

    /// Stop the station. Called once, at the deadline.
    @ObservationIgnored public var onFire: (@MainActor () -> Void)?
    /// Set the player's volume, from 1 down during the fade and back to 1 afterwards.
    @ObservationIgnored public var onVolume: (@MainActor (Float) -> Void)?

    @ObservationIgnored private let schedule: Schedule
    @ObservationIgnored private let now: @MainActor () -> ContinuousClock.Instant
    @ObservationIgnored private let fadeSteps: Int
    @ObservationIgnored private var pending: Cancel?
    @ObservationIgnored private var fading = false
    /// The record "after this record" is waiting out, by when it started; `nil` once it is over.
    @ObservationIgnored private var waitingOut: Int?
    @ObservationIgnored private var lastReading: Reading<NowPlaying>?
    @ObservationIgnored private var lastBuffered: Duration = .zero

    public init(schedule: @escaping Schedule = Scheduling.tasks, now: @escaping @MainActor () -> ContinuousClock.Instant = { .now }, fadeSteps: Int = 20) {
        self.schedule = schedule
        self.now = now
        self.fadeSteps = fadeSteps
    }

    public func arm(_ request: SleepRequest) {
        cancelPending()
        switch request {
        case .minutes(let minutes):
            waitingOut = nil
            set(.until(now() + .seconds(minutes * 60)))
        case .afterRecord:
            waitingOut = lastReading?.value.track?.startedAt
            set(.afterRecord(deadline(for: lastReading, buffered: lastBuffered)))
        }
    }

    /// Turn it off, and put the sound back if it was already fading.
    public func clear() {
        cancelPending()
        waitingOut = nil
        if fading { restoreVolume() }
        if state != .off { set(.off) }
    }

    /// The player stopped for a reason of its own. The timer was for that session.
    public func onStopped() { clear() }

    /// A fresh reading, with how much audio the player is holding at that moment.
    public func onReading(_ reading: Reading<NowPlaying>?, buffered: Duration) {
        lastReading = reading
        lastBuffered = buffered
        guard case .afterRecord(let previous) = state else { return }
        let track = reading?.value.track

        let next: ContinuousClock.Instant?
        if let startedAt = waitingOut {
            if track?.startedAt == startedAt {
                // The same record: re-anchor, since `remainingMs` does.
                next = deadline(for: reading, buffered: buffered) ?? previous
            } else {
                // Something else is on air, or nothing is: over for the station, and over for the
                // listener once the buffer has played out.
                waitingOut = nil
                next = now() + buffered
            }
        } else if previous == nil, let track {
            // Armed before any reading could say which record: this is the one.
            waitingOut = track.startedAt
            next = deadline(for: reading, buffered: buffered)
        } else {
            return
        }

        // Readings a few hundred milliseconds apart in their projection are the same deadline.
        guard let next else { return }
        if let previous, abs((next - previous) / .milliseconds(1)) < 1000 { return }
        cancelPending()
        set(.afterRecord(next))
    }

    /// What the line under the play button says, or `nil` when the timer is off. Rounded up to the
    /// minute, so it never says "0 min" while there is still music playing.
    public func line(at instant: ContinuousClock.Instant) -> Message? {
        switch state {
        case .off: return nil
        case .afterRecord: return .stopsAfterThisRecord
        case .until(let deadline):
            let left = max(0, (deadline - instant) / .milliseconds(1))
            return .stopsIn(spanOf(max(1, Int((left / 60_000).rounded(.up)))))
        }
    }

    private func deadline(for reading: Reading<NowPlaying>?, buffered: Duration) -> ContinuousClock.Instant? {
        guard let reading, let remaining = reading.value.track?.remainingMs else { return nil }
        return reading.readAt + .milliseconds(remaining) + buffered
    }

    private func set(_ next: SleepState) {
        state = next
        let deadline: ContinuousClock.Instant?
        switch next {
        case .off: deadline = nil
        case .until(let at): deadline = at
        case .afterRecord(let at): deadline = at
        }
        guard let deadline else { return }
        // A deadline moved out of the fade window puts the sound back.
        if fading, deadline - now() > Self.fade { restoreVolume() }
        let wait = max(.zero, deadline - Self.fade - now())
        pending = schedule(wait) { [weak self] in self?.fadeStep(toward: deadline) }
    }

    private func fadeStep(toward deadline: ContinuousClock.Instant) {
        let left = deadline - now()
        guard left > .zero else { return fire() }
        fading = true
        onVolume?(Float(min(max(left / Self.fade, 0), 1)))
        pending = schedule(min(Self.fade / fadeSteps, left)) { [weak self] in self?.fadeStep(toward: deadline) }
    }

    private func fire() {
        pending = nil
        waitingOut = nil
        state = .off
        onFire?()
        restoreVolume()
    }

    private func cancelPending() {
        pending?()
        pending = nil
    }

    private func restoreVolume() {
        fading = false
        onVolume?(1)
    }
}
