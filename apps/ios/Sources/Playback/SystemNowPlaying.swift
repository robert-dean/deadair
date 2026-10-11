import DeadairCore
import DeadairSdk
import MediaPlayer

/// The lock screen, Control Center, headphones and a car: the system's own now-playing display and
/// the buttons that come with it.
///
/// **Play and stop are the only verbs.** Pause, stop and the toggle all stop, because a paused
/// connection is still a listener and the station would stay on air for five minutes for nobody.
/// Previous, seeking and scrubbing are withdrawn: a live stream has no position to move to.
///
/// **A record's progress is shown, and never dragged.** While a record with a length is playing the
/// tile is told how far through it the listener is (`LockScreenProgress`), and is told the item is
/// NOT live, because the lock screen draws a live stream as a LIVE badge with no bar at all,
/// whatever elapsed time it is given. A break, or anything without a length, stays the live stream
/// it is. `changePlaybackPositionCommand` stays disabled either way, so the bar is not a scrubber.
///
/// **Next is the OPERATOR's Skip, offered only while the account is the operator, and that is the
/// whole of the safety**, as on Android. A listener's lock screen draws nothing rather than a button
/// the station would refuse. What it does NOT solve, accepted knowingly as Android accepted it: the
/// same control means "next track" in every other app, so a passenger reaching for it in a car cuts
/// the record for everybody listening, with no second press to think in. The desktop app answered
/// that with a setting that is off by default; this app answers it as Android does. It is not gated
/// on there being anything to skip either: the screen's Skip is, because it has the transport reading
/// in front of it, and the player deliberately polls none of that.
@MainActor
final class SystemNowPlaying {
    var onPlay: (() -> Void)?
    var onStop: (() -> Void)?
    var onSkip: (() -> Void)?
    /// Whether the app is asking for audio, for the toggle.
    var isPlaying: () -> Bool = { false }

    var canSkip = false {
        didSet { MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled = canSkip }
    }

    init() {
        let centre = MPRemoteCommandCenter.shared()
        // Commands arrive on the main thread, and `run` asserts it rather than a closure inheriting
        // the main actor and having Swift check it silently: the same check that crashed the player.
        centre.playCommand.addTarget { @Sendable [weak self] _ in self?.run { $0.onPlay?() } ?? .commandFailed }
        centre.pauseCommand.addTarget { @Sendable [weak self] _ in self?.run { $0.onStop?() } ?? .commandFailed }
        centre.stopCommand.addTarget { @Sendable [weak self] _ in self?.run { $0.onStop?() } ?? .commandFailed }
        centre.togglePlayPauseCommand.addTarget { @Sendable [weak self] _ in
            self?.run { $0.isPlaying() ? $0.onStop?() : $0.onPlay?() } ?? .commandFailed
        }
        centre.nextTrackCommand.addTarget { @Sendable [weak self] _ in self?.run { $0.onSkip?() } ?? .commandFailed }
        centre.nextTrackCommand.isEnabled = false

        for command in [centre.previousTrackCommand, centre.seekForwardCommand, centre.seekBackwardCommand,
                        centre.skipForwardCommand, centre.skipBackwardCommand, centre.changePlaybackPositionCommand] {
            command.isEnabled = false
        }
    }

    /// What the system shows for a reading. Which line says what is `lockScreenLines`'s decision.
    func show(station: String, reading: NowPlaying?, artwork: PlatformImage?, playing: Bool, progress: LockScreenProgress?) {
        let lines = lockScreenLines(station: station, reading: reading)
        var info: [String: Any] = [
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPMediaItemPropertyTitle: lines.title.words,
            MPMediaItemPropertyArtist: lines.artist.words,
        ]
        Self.apply(progress, playing: playing, to: &info)
        if let album = lines.album { info[MPMediaItemPropertyAlbumTitle] = album }
        if let artwork {
            let held = HeldImage(image: artwork)
            // `@Sendable` so it does not inherit the main actor: MediaPlayer asks for the image from
            // its own thread, and an inherited main actor is checked at run time and crashes.
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: artwork.size) { @Sendable _ in held.image }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// Move the bar, or start or stop it, without touching anything else the tile says.
    ///
    /// The system runs the bar on by itself from the elapsed time, the moment it was set and the
    /// rate, so this is needed only when that would go wrong: a new record, a bar appearing or
    /// going, and the rate changing as the audio stops or starts. `LockScreenProgressState` decides.
    func update(progress: LockScreenProgress?, playing: Bool) {
        let centre = MPNowPlayingInfoCenter.default()
        guard var info = centre.nowPlayingInfo else { return }
        Self.apply(progress, playing: playing, to: &info)
        centre.nowPlayingInfo = info
    }

    /// The live flag, the rate and, for a record, where it is and how long it is.
    private static func apply(_ progress: LockScreenProgress?, playing: Bool, to info: inout [String: Any]) {
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        if let progress {
            info[MPNowPlayingInfoPropertyIsLiveStream] = false
            info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = progress.elapsedSeconds
            info[MPMediaItemPropertyPlaybackDuration] = progress.durationSeconds
        } else {
            info[MPNowPlayingInfoPropertyIsLiveStream] = true
            info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = nil
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = nil
            info[MPMediaItemPropertyPlaybackDuration] = nil
        }
    }

    /// Nothing is playing and nothing will be: take the tile down.
    func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    /// Commands arrive on the main thread.
    nonisolated private func run(_ body: @MainActor (SystemNowPlaying) -> Void) -> MPRemoteCommandHandlerStatus {
        MainActor.assumeIsolated { body(self) }
        return .success
    }

    /// An image handed to the artwork callback, which the system may call from any thread. A
    /// finished image is never changed afterwards.
    private struct HeldImage: @unchecked Sendable {
        let image: PlatformImage
    }
}
