import AVFoundation
import DeadairCore
import os

/// What playback did, for `log stream --predicate 'subsystem == "com.maroonedsoftware.deadair"'`.
private let log = Logger(subsystem: "com.maroonedsoftware.deadair", category: "playback")

/// The station's audio, through the platform's own player.
///
/// AVFoundation rather than a bundled engine, which is the desktop app's choice for the same stack:
/// `AVPlayer` plays an ICY MP3 mount and an HLS playlist natively, and ships with the operating
/// system. It reports phases and nothing else; what a phase MEANS is `PlaybackConductor`'s.
///
/// Three things carried over from `apps/desktop/native/mac/DeadairPlayer.m`, which measured them:
///
/// - **A fresh item on every play.** Re-preparing a failed item does not clear its status, and after
///   a stop there is no item at all.
/// - **Stop replaces the item with nothing.** Pausing a live mount holds the connection open, and
///   the station counts that connection as an audience for five minutes.
/// - **The agent goes on through `AVURLAssetHTTPUserAgentKey`**, which reaches the request carrying
///   the audio, the HLS playlists and the segments. The older header-fields option reaches only
///   some of them, and the rest go out as AppleCoreMedia: a second listener for one person.
@MainActor
final class StationPlayer {
    var onPhase: ((PlayerPhase) -> Void)?
    /// The in-band title changed: ICY's `StreamTitle` on a mount, ID3 in an HLS segment. Both change
    /// when the ENCODER moves on, so they arrive on the audio's schedule rather than the poll's.
    var onTitle: ((String?) -> Void)?

    private(set) var phase: PlayerPhase = .stopped

    private var player: AVPlayer
    private let userAgent: String
    private var timeControl: NSKeyValueObservation?
    private var itemStatus: NSKeyValueObservation?
    private var itemObservers: [NSObjectProtocol] = []
    private var reader: TimedTitleReader?
    /// Whether a stop was asked for, so the teardown that follows is not reported as a failure.
    private var stopping = false

    init(userAgent: String) {
        self.userAgent = userAgent
        player = AVPlayer()
        watch(player)
    }

    func play(_ url: URL) {
        stopping = false
        detachItem()

        let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPUserAgentKey: userAgent])
        let item = AVPlayerItem(asset: asset)
        attach(item)

        // Before the first byte, so the screen draws warm-up rather than nothing.
        report(.opening)
        player.replaceCurrentItem(with: item)
        player.play()
    }

    func stop() {
        stopping = true
        detachItem()
        player.pause()
        // The line that matters. See the type's comment.
        player.replaceCurrentItem(with: nil)
        report(.stopped)
    }

    /// Throw the player away and build another, for when the media server has restarted under it.
    func rebuild() {
        stop()
        timeControl = nil
        player = AVPlayer()
        watch(player)
    }

    /// How much audio is waiting in the buffer: how far the listener's ears are behind the poll.
    var buffered: Duration {
        guard let item = player.currentItem, let range = item.loadedTimeRanges.last?.timeRangeValue else { return .zero }
        let ahead = CMTimeGetSeconds(CMTimeRangeGetEnd(range)) - CMTimeGetSeconds(item.currentTime())
        return ahead.isFinite && ahead > 0 ? .milliseconds(Int(ahead * 1000)) : .zero
    }

    private func watch(_ player: AVPlayer) {
        // The station is live: there is nothing to catch up to, and waiting to minimise stalls is
        // what a live stream wants.
        player.automaticallyWaitsToMinimizeStalling = true
        // `@Sendable`, and that is not decoration. A closure written in a main-actor type inherits the
        // main actor, and when it is handed to an Objective-C API not marked `Sendable`, Swift 6
        // checks at run time that it runs there. AVFoundation fires KVO on its own queue, and the
        // first build crashed five seconds after play on exactly that check. Explicitly `@Sendable`
        // closures inherit nothing; each hops to the main actor itself.
        timeControl = player.observe(\.timeControlStatus, options: [.new]) { @Sendable [weak self] player, _ in
            let status = player.timeControlStatus
            Task { @MainActor in self?.timeControlChanged(status) }
        }
    }

    private func timeControlChanged(_ status: AVPlayer.TimeControlStatus) {
        guard !stopping else { return }
        switch status {
        case .playing: report(.playing)
        case .waitingToPlayAtSpecifiedRate: report(phase == .opening ? .opening : .buffering)
        // Reached on the way down from a failure as well as from a stop, so it is not a phase of
        // its own: whatever caused it has already said so.
        case .paused: break
        @unknown default: break
        }
    }

    private func attach(_ item: AVPlayerItem) {
        itemStatus = item.observe(\.status, options: [.new]) { @Sendable [weak self] item, _ in
            let failed = item.status == .failed
            Task { @MainActor in if failed { self?.report(.failed) } }
        }
        let centre = NotificationCenter.default
        itemObservers = [
            // A live mount does not end on its own, so this is the stream going away.
            centre.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.report(.ended) }
            },
            centre.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.report(.failed) }
            },
            centre.addObserver(forName: AVPlayerItem.playbackStalledNotification, object: item, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, !self.stopping else { return }
                    self.report(.buffering)
                }
            },
        ]
        reader = TimedTitleReader(item: item) { [weak self] title in self?.onTitle?(title) }
    }

    private func detachItem() {
        itemStatus = nil
        itemObservers.forEach(NotificationCenter.default.removeObserver)
        itemObservers = []
        reader = nil
    }

    private func report(_ next: PlayerPhase) {
        guard next != phase else { return }
        log.info("phase \(String(describing: next), privacy: .public)")
        phase = next
        onPhase?(next)
    }
}

/// The in-band title, as the playback timeline reaches it.
///
/// `AVPlayerItemMetadataOutput` rather than the deprecated `timedMetadata`, because it delivers a
/// group when the AUDIO reaches it, which is the whole premise of the lock-screen gate. One per
/// item: a stop replaces the item, so a play builds a new reader.
final class TimedTitleReader: NSObject, AVPlayerItemMetadataOutputPushDelegate, @unchecked Sendable {
    private let output = AVPlayerItemMetadataOutput(identifiers: [
        // An Icecast mount's `StreamTitle`.
        AVMetadataIdentifier.icyMetadataStreamTitle.rawValue,
        // An HLS segment's ID3 title, which Liquidsoap writes into the ADTS segments it cuts.
        AVMetadataIdentifier.id3MetadataTitleDescription.rawValue,
    ])
    private let queue = DispatchQueue(label: "radio.deadair.timed-title")
    private let onTitle: @MainActor (String?) -> Void

    init(item: AVPlayerItem, onTitle: @escaping @MainActor (String?) -> Void) {
        self.onTitle = onTitle
        super.init()
        // Never the main queue: AVFoundation delivers on the queue it is given, and the main one
        // is busy drawing.
        output.setDelegate(self, queue: queue)
        item.add(output)
    }

    func metadataOutput(_ output: AVPlayerItemMetadataOutput, didOutputTimedMetadataGroups groups: [AVTimedMetadataGroup], from track: AVPlayerItemTrack?) {
        for item in groups.flatMap(\.items) {
            let onTitle = onTitle
            let held = Held(item: item)
            Task {
                let title = try? await held.item.load(.stringValue)
                log.info("in-band title \(held.item.identifier?.rawValue ?? "?", privacy: .public): \(title ?? "none", privacy: .public)")
                await onTitle(title ?? nil)
            }
        }
    }

    /// An `AVMetadataItem` handed to the task that loads its value. The class is immutable (the
    /// mutable subclass is not what a metadata output hands out), so moving one across shares
    /// nothing that can change; it is simply not marked `Sendable` by the SDK.
    private struct Held: @unchecked Sendable {
        let item: AVMetadataItem
    }
}
