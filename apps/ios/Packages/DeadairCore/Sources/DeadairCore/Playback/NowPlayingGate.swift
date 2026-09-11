import DeadairSdk

/// Decides when the poll's reading actually reaches the lock screen.
///
/// The poll and the audio disagree about when a record changed: the poll learns it the moment the
/// station's own director commits the next item, and the audio carries it however many seconds
/// are sitting in the player's buffer at that instant. Pushing on the poll alone changes the lock
/// screen before the listener hears anything different, which reads as wrong even though the data
/// was right. So the in-band title (ICY on a mount, ID3 in an HLS segment, both of which change
/// when the ENCODER moves to the new record and therefore arrive on the same schedule as the audio)
/// is the trigger, and the poll stays the source of the fields pushed.
///
/// `apps/android`'s `NowPlayingGate`, decision for decision. `schedule` is injected so the timing is
/// tested on a clock the test moves.
@MainActor
public final class NowPlayingGate {
    private let schedule: Schedule
    /// Where a released reading goes. Settable so an owner can wire it once it is itself built.
    public var push: @MainActor (NowPlaying?) -> Void

    private var pending: Cancel?
    /// The reading held back because its track moved and the audio has not caught up yet.
    private var held: NowPlaying?
    /// The most recent reading seen, held or not: what a title change with nothing held falls back to.
    private var latest: NowPlaying?
    private var seenFirst = false
    private var lastTitle: String?
    /// What was pushed for last, so an unmoved `startedAt` can still be told from a moved one.
    private var pushedFor: Int?
    /// The fields of the last pushed reading that the lock screen shows, so a poll that changed
    /// nothing visible is a no-op rather than a fresh push every three seconds.
    private var lastPushedShown: Shown?

    public init(schedule: @escaping Schedule = Scheduling.tasks, push: @escaping @MainActor (NowPlaying?) -> Void = { _ in }) {
        self.schedule = schedule
        self.push = push
    }

    /// A fresh poll reading. `buffered` is how much audio the player holds at the moment of the
    /// poll: exactly how far behind the poll the listener's ears are, and so also how long the
    /// held reading may wait before being pushed anyway, title change or not.
    public func onPoll(_ reading: NowPlaying?, buffered: Duration) {
        latest = reading
        let startedAt = reading?.track?.startedAt
        let trackMoved = seenFirst && startedAt != pushedFor
        seenFirst = true

        guard trackMoved else {
            cancelPending()
            held = nil
            // A field the lock screen does not show (listeners, remainingMs) moving on its own is
            // not a reason to push: only what `Shown` captures is.
            if Shown(reading) != lastPushedShown { pushNow(reading) }
            return
        }

        // A buffer longer than the poll interval (routine on HLS) means this same moved track is
        // seen again before its release fires. Cancelling and rescheduling on every one of those
        // polls would push the release out each time and it would never happen, so a poll still
        // describing the held track only refreshes the fields to be pushed.
        if pending != nil, startedAt == held?.track?.startedAt {
            held = reading
            return
        }

        held = reading
        cancelPending()
        pending = schedule(buffered) { [weak self] in self?.releaseHeld() }
    }

    /// The in-band title changed. Whatever was held is released early, and a change with nothing
    /// held still republishes the latest reading, because the change just proved the audio caught
    /// up to it.
    public func onTitle(_ title: String?) {
        guard title != lastTitle else { return }
        lastTitle = title
        guard seenFirst else { return }

        cancelPending()
        let toPush = held ?? latest
        held = nil
        pushNow(toPush)
    }

    /// Drop a pending release, and forget what was last pushed: the caller is about to hand the
    /// system a fresh item with blank metadata (a format change, a station change), so the next
    /// poll must push even if nothing about the reading moved.
    public func cancel() {
        cancelPending()
        held = nil
        lastPushedShown = nil
    }

    private func releaseHeld() {
        pending = nil
        guard let reading = held else { return }
        held = nil
        pushNow(reading)
    }

    private func pushNow(_ reading: NowPlaying?) {
        pushedFor = reading?.track?.startedAt
        lastPushedShown = Shown(reading)
        push(reading)
    }

    private func cancelPending() {
        pending?()
        pending = nil
    }

    /// The fields of a reading that reach the lock screen, Control Center and a car.
    private struct Shown: Equatable {
        let present: Bool
        let station: String?
        let title: String?
        let artist: String?
        let album: String?
        let artworkUrl: String?

        init(_ reading: NowPlaying?) {
            present = reading != nil
            station = reading?.station
            title = reading?.track?.title
            artist = reading?.track?.artist
            album = reading?.track?.album
            artworkUrl = reading?.track?.artworkUrl
        }
    }
}
