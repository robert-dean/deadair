import Observation

/// What the player reports, whichever platform stack is underneath it.
public enum PlayerPhase: Equatable, Sendable {
    case stopped
    /// Asked for a mount, and no byte of audio yet.
    case opening
    case playing
    /// Had audio, and is waiting for more.
    case buffering
    /// The stream ended. A live mount does not end on its own, so this is the stream going away.
    case ended
    case failed
}

/// What a listener should be told the player is doing.
public enum ListeningState: Equatable, Sendable {
    /// Not listening.
    case stopped

    /// Asked to play and no audio yet.
    ///
    /// This covers a case that looks like a fault and is not. On an audience-gated station,
    /// connecting is what puts it on air, so the first seconds after pressing play are the lease
    /// being taken, the first record being fetched and the encoder starting, and there is
    /// legitimately no audio during them. First audio on the MP3 mount was measured at about five
    /// seconds from the desktop app, on the same AVFoundation stack this app uses.
    case warmingUp

    case playing

    /// Was playing, lost it, and is trying again.
    case reconnecting

    /// Tried for long enough that something is actually wrong.
    case unreachable
}

/// The policy above the player: what a phase MEANS, and when to try again.
///
/// Deliberately not inside the player. `AVPlayer` reports roughly the states every media stack
/// reports and none of them knows what this station does with a connection, so the
/// interpretation is written here, where it can be tested without a sound card. It is the desktop
/// app's `PlaybackConductor`, which drives the same AVFoundation player on a Mac.
///
/// The rule that shapes it: **a failure before the first successful play is warm-up, not a
/// fault.** Both because the station may be waking up, and because a listener who has just pressed
/// play has no use for an error they cannot act on. Only after audio has been heard does losing it
/// become reconnecting, and only after the backoff gives up does it become unreachable.
@MainActor
@Observable
public final class PlaybackConductor {
    public private(set) var state: ListeningState = .stopped
    /// Whether the listener has asked for audio and not since asked it to stop.
    public private(set) var wantsToPlay = false
    /// How long until the next attempt, or `nil` when none is due.
    public private(set) var retryIn: Duration?

    /// Called once `retryIn` has elapsed and the listener still wants to be playing.
    @ObservationIgnored public var onRetryDue: (@MainActor () -> Void)?

    @ObservationIgnored private var backoff: Backoff
    @ObservationIgnored private var heardAudio = false
    @ObservationIgnored private var pendingRetry: Cancel?
    @ObservationIgnored private let schedule: Schedule

    public init(backoff: Backoff = Backoff(), schedule: @escaping Schedule = Scheduling.tasks) {
        self.backoff = backoff
        self.schedule = schedule
    }

    /// The listener pressed play.
    public func requested() {
        wantsToPlay = true
        heardAudio = false
        backoff.reset()
        retryIn = nil
        state = .warmingUp
        disarm()
    }

    /// The listener pressed stop, or something the listener would count as stop happened: a call
    /// came in, the headphones came out.
    public func released() {
        wantsToPlay = false
        heardAudio = false
        backoff.reset()
        retryIn = nil
        state = .stopped
        disarm()
    }

    /// A reading from the player.
    public func observed(_ phase: PlayerPhase) {
        guard wantsToPlay else {
            state = .stopped
            retryIn = nil
            return
        }

        switch phase {
        case .playing:
            heardAudio = true
            backoff.reset()
            retryIn = nil
            state = .playing
            disarm()

        case .opening, .buffering:
            retryIn = nil
            // Buffering after audio has been heard is an ordinary hiccup and stays "playing", so a
            // two-second stall does not flash a reconnecting banner at somebody.
            state = heardAudio ? .playing : .warmingUp

        case .ended, .failed:
            retryAfterDrop(fromWarmUp: !heardAudio)

        case .stopped:
            // The player stopping while the listener still wants to hear it means something took
            // it down; a drop, not the listener's own stop. Before any audio it is the player
            // settling between items and means nothing yet.
            if heardAudio { retryAfterDrop(fromWarmUp: false) }
        }
    }

    private func retryAfterDrop(fromWarmUp: Bool) {
        // Unreachable on the attempt whose wait spends the budget, not one attempt later.
        guard let wait = backoff.next(), !backoff.exhausted else {
            // Given up. Arming another timer here would retry forever under a banner that says
            // otherwise.
            retryIn = nil
            state = .unreachable
            disarm()
            return
        }
        retryIn = wait
        state = fromWarmUp ? .warmingUp : .reconnecting
        // Only the most recent failure's wait is worth honouring.
        disarm()
        pendingRetry = schedule(wait) { [weak self] in
            guard let self else { return }
            self.pendingRetry = nil
            // The listener may have pressed stop, or the player may have recovered on its own,
            // in the moment between the timer being armed and it firing.
            if self.wantsToPlay, self.state != .playing { self.onRetryDue?() }
        }
    }

    private func disarm() {
        pendingRetry?()
        pendingRetry = nil
    }
}
