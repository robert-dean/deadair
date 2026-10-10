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
    /// Ask the station now rather than waiting for the next poll.
    ///
    /// Called when the in-band title moves with nothing held, which is the encoder saying the record
    /// changed before the poll had noticed. The reading in hand then describes the record that just
    /// ENDED, so publishing it would put the wrong title up; the answer to this is what goes up.
    public var refresh: @MainActor () -> Void
    /// The reading the listener is hearing, for the app's own screens.
    ///
    /// Every reading that is not being held goes through here, not only the ones that change what
    /// the lock screen shows, because the screens draw a playhead from it and a playhead re-anchors
    /// on every reading. Its `readAt` is moved later by the buffer that stood between the poll and
    /// the listener's ears, so `Playhead.project` counts down from what is audible rather than from
    /// what the station's decoder was doing: projected from the poll's own stamp, the bar ran a
    /// whole buffer ahead of the audio.
    ///
    /// `nil` is no reading at all, never "off air": an off-air answer is a reading like any other.
    public var aired: @MainActor (Reading<NowPlaying>?) -> Void

    private var pending: Cancel?
    /// The reading held back because its track moved and the audio has not caught up yet.
    private var held: NowPlaying?
    /// `held`, stamped for the listener's ears: what `aired` is told when it is released.
    private var heldAired: Reading<NowPlaying>?
    private var seenFirst = false
    private var lastTitle: String?
    /// A title change has asked the station for a fresh reading, and the next one is that answer.
    private var awaitingRefresh = false
    /// What was pushed for last, so an unmoved `startedAt` can still be told from a moved one.
    private var pushedFor: Int?
    /// The fields of the last pushed reading that the lock screen shows, so a poll that changed
    /// nothing visible is a no-op rather than a fresh push every three seconds.
    private var lastPushedShown: Shown?

    public init(
        schedule: @escaping Schedule = Scheduling.tasks,
        refresh: @escaping @MainActor () -> Void = {},
        aired: @escaping @MainActor (Reading<NowPlaying>?) -> Void = { _ in },
        push: @escaping @MainActor (NowPlaying?) -> Void = { _ in }
    ) {
        self.schedule = schedule
        self.refresh = refresh
        self.aired = aired
        self.push = push
    }

    /// A fresh poll reading. `buffered` is how much audio the player holds at the moment of the
    /// poll: exactly how far behind the station the listener's ears are.
    ///
    /// `age` is how long ago the reading was actually TAKEN. The hold is the part of the buffer
    /// that has not played yet, so it is the buffer MINUS that age: a reading that waited out a
    /// backed-off poll already describes the past, and holding the whole buffer again would publish
    /// the record that much after the listener heard it start. Android's gate learned this when
    /// its poll slowed down; here the poll only slows while the station is failing, but the
    /// arithmetic is the same.
    ///
    /// `readAt` is the reading's own stamp. Unlike the hold it moves by the WHOLE buffer, however old
    /// the reading is: the listener is `buffered` behind the station at every moment, so the moment
    /// the reading describes reaches them `buffered` after it was read. Omitted, it is now.
    public func onPoll(_ reading: NowPlaying?, buffered: Duration, age: Duration = .zero, readAt: ContinuousClock.Instant? = nil) {
        let stamp = (readAt ?? .now).advanced(by: max(buffered, .zero))
        let heard = reading.map { Reading($0, readAt: stamp) }
        let startedAt = reading?.track?.startedAt
        let trackMoved = seenFirst && startedAt != pushedFor
        // The answer a title change asked for: the audio is already known to have reached whatever
        // it says, so there is nothing left to hold it for.
        let confirming = awaitingRefresh
        awaitingRefresh = false
        seenFirst = true

        if !trackMoved || confirming {
            cancelPending()
            held = nil
            heldAired = nil
            aired(heard)
            // Moved even when nothing is pushed, so a record whose shown fields match the one before
            // it (the same track aired twice) is not read as a fresh change by every later poll.
            pushedFor = startedAt
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
            heldAired = heard
            return
        }

        held = reading
        heldAired = heard
        cancelPending()
        pending = schedule(max(buffered - age, .zero)) { [weak self] in self?.releaseHeld() }
    }

    /// The in-band title changed: the encoder has moved to the next record, on the audio's own
    /// schedule, which is the listener's.
    ///
    /// Whatever was held is released early. With nothing held the poll has NOT seen the new record
    /// yet, so the reading in hand is the one that just ended; the station is asked instead, and
    /// `onPoll` publishes the answer the moment it lands. Republishing the latest reading was what
    /// this did, which put the previous record back up at the moment the next one started.
    public func onTitle(_ title: String?) {
        guard title != lastTitle else { return }
        lastTitle = title
        guard seenFirst else { return }

        cancelPending()
        let toRelease = held
        let toAir = heldAired
        held = nil
        heldAired = nil
        if let toRelease {
            aired(toAir)
            pushNow(toRelease)
            return
        }
        awaitingRefresh = true
        refresh()
    }

    /// Drop a pending release, and forget what was last pushed: the caller is about to hand the
    /// system a fresh item with blank metadata (a format change, a station change), so the next
    /// poll must push even if nothing about the reading moved.
    public func cancel() {
        cancelPending()
        held = nil
        heldAired = nil
        lastPushedShown = nil
        awaitingRefresh = false
    }

    private func releaseHeld() {
        pending = nil
        guard let reading = held else { return }
        let toAir = heldAired
        held = nil
        heldAired = nil
        aired(toAir)
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
    ///
    /// The kind and the show among them, because `lockScreenLines` draws a break from the host and
    /// the show's name: a recast during a break changes what the lock screen says with nothing
    /// about the item moving. The host's picture too, which is a break's artwork when they have one.
    private struct Shown: Equatable {
        let present: Bool
        let station: String?
        let kind: NowPlayingTrackKind?
        let title: String?
        let artist: String?
        let album: String?
        let artworkUrl: String?
        let show: String?
        let host: String?
        let hostArtUrl: String?

        init(_ reading: NowPlaying?) {
            present = reading != nil
            station = reading?.station
            kind = reading?.track?.kind
            title = reading?.track?.title
            artist = reading?.track?.artist
            album = reading?.track?.album
            artworkUrl = reading?.track?.artworkUrl
            show = reading?.show?.name
            host = reading?.show?.host
            hostArtUrl = reading?.show?.hostArtUrl
        }
    }
}
