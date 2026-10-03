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
///
/// **With no network, a drop waits for one instead of spending the backoff.** A phone in a lift or
/// a tunnel used to retry against nothing for five minutes and then give up, even when the signal
/// came back seconds later. Now a drop with no network schedules nothing until `networkChanged`
/// says one is up, and then the retry is due at once, from a fresh backoff: the failures before it
/// were the missing network, not the station. The wait has its own, longer limit, after which it is
/// unreachable for the same reason the backoff gives up.
///
/// **A stream held on one connection moves with the network.** A mount is a single socket on
/// whichever interface carried it when it connected, and a handover leaves it there: dead when
/// wifi fades, or running on over mobile data the listener would rather not spend. So a move to
/// another network makes the retry due at once, for a stream that has not failed as much as for
/// one that has. HLS is a request per segment, each on the network of the moment, and is left alone.
@MainActor
@Observable
public final class PlaybackConductor {
    public private(set) var state: ListeningState = .stopped
    /// Whether the listener has asked for audio and not since asked it to stop.
    public private(set) var wantsToPlay = false
    /// How long until the next attempt, or `nil` when none is due.
    public private(set) var retryIn: Duration?
    /// Whether a drop is being held until the phone has a network again. No attempt is scheduled
    /// while it is, so `retryIn` is `nil`, but a retry is still coming.
    public private(set) var awaitingNetwork = false

    /// Called once `retryIn` has elapsed and the listener still wants to be playing.
    @ObservationIgnored public var onRetryDue: (@MainActor () -> Void)?

    /// Called when a drop held for the network has waited as long as it is going to, and the state
    /// has become `unreachable` with no reading from the player to say so.
    @ObservationIgnored public var onGaveUpWaiting: (@MainActor () -> Void)?

    @ObservationIgnored private var backoff: Backoff
    @ObservationIgnored private var heardAudio = false
    @ObservationIgnored private var pendingRetry: Cancel?
    @ObservationIgnored private let schedule: Schedule
    @ObservationIgnored private let offlineLimit: Duration
    /// Whether the phone has a network to reach the station over. Assumed until told otherwise.
    @ObservationIgnored private var online = true
    /// The last network the phone was on, kept through a spell with none, so a return can be told
    /// from a move.
    @ObservationIgnored private var lastNetwork: String?
    @ObservationIgnored private var offlineGiveUp: Cancel?

    /// `offlineLimit` is how long a drop waits for the network before it is unreachable. Longer than
    /// the backoff, because waiting costs nothing (no request is made), and a stretch of underground
    /// between two stations is longer than five minutes. Not for ever, because a station that
    /// starts playing out of a pocket half an hour after it went quiet is a surprise, not a feature.
    public init(backoff: Backoff = Backoff(), schedule: @escaping Schedule = Scheduling.tasks, offlineLimit: Duration = .seconds(15 * 60)) {
        self.backoff = backoff
        self.schedule = schedule
        self.offlineLimit = offlineLimit
    }

    /// The listener pressed play.
    public func requested() {
        wantsToPlay = true
        heardAudio = false
        backoff.reset()
        retryIn = nil
        state = .warmingUp
        disarm()
        stopWaitingForNetwork()
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
        stopWaitingForNetwork()
    }

    /// The phone's network, by an identity that tells one network from another, or `nil` for none.
    /// `heldConnection` says whether the stream rides one long connection, which a move leaves
    /// behind.
    ///
    /// Losing it does nothing to a stream still playing out of its buffer: the player says so
    /// itself when it fails, and only then is there a drop to hold. It does take back a retry that
    /// is already scheduled, which would otherwise fire against nothing and spend backoff doing it.
    ///
    /// A DIFFERENT network than the last one, with or without a spell of none between them, is a
    /// move: a scheduled retry is made now rather than at the end of its wait, and a held
    /// connection that has not failed yet is replaced, because it is on a network that is going or
    /// gone. The SAME network coming back is not a move, and a connection that survived the blip is
    /// left be.
    public func networkChanged(_ network: String?, heldConnection: Bool = true) {
        guard let network else {
            guard online else { return }
            online = false
            if pendingRetry != nil {
                disarm()
                retryIn = nil
                waitForNetwork()
            }
            return
        }
        let moved = lastNetwork != nil && network != lastNetwork
        let returned = !online
        lastNetwork = network
        online = true
        guard moved || returned else { return }

        let held = awaitingNetwork || pendingRetry != nil
        stopWaitingForNetwork()
        disarm()
        retryIn = nil
        guard wantsToPlay else { return }
        if held {
            backoff.reset()
            onRetryDue?()
        } else if moved, heldConnection {
            onRetryDue?()
        }
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
            stopWaitingForNetwork()

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
        state = fromWarmUp ? .warmingUp : .reconnecting
        guard online else {
            disarm()
            retryIn = nil
            waitForNetwork()
            return
        }
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

    /// Hold the drop until the network is back, for at most `offlineLimit` from when the wait
    /// began: a second failure while already waiting does not start the limit again.
    private func waitForNetwork() {
        awaitingNetwork = true
        guard offlineGiveUp == nil else { return }
        offlineGiveUp = schedule(offlineLimit) { [weak self] in
            guard let self else { return }
            self.offlineGiveUp = nil
            self.awaitingNetwork = false
            guard self.wantsToPlay else { return }
            self.state = .unreachable
            self.onGaveUpWaiting?()
        }
    }

    private func stopWaitingForNetwork() {
        awaitingNetwork = false
        offlineGiveUp?()
        offlineGiveUp = nil
    }

    private func disarm() {
        pendingRetry?()
        pendingRetry = nil
    }
}
