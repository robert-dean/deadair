import DeadairSdk
import MediaPlayer

/// The lock screen, Control Center, headphones and a car: the system's own now-playing display and
/// the buttons that come with it.
///
/// **Play and stop are the only verbs.** Pause, stop and the toggle all stop, because a paused
/// connection is still a listener and the station would stay on air for five minutes for nobody.
/// Previous, seeking and scrubbing are withdrawn: a live stream has no position.
///
/// **Next is the OPERATOR's Skip, and it is registered and disabled.** A listener's lock screen
/// draws nothing rather than a button the station would refuse. Turning it on is the operator
/// remote's work, and it has to answer the question the desktop app answered with a setting that is
/// off by default: a lock screen is in reach of anybody holding the phone, and one press cuts the
/// record for everybody listening.
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

    /// What the system shows for a reading. Off air, the station's name is the title and "Off air"
    /// the line under it, which is what a lock screen should say about a radio that is quiet.
    func show(station: String, reading: NowPlaying?, artwork: PlatformImage?, playing: Bool) {
        var info: [String: Any] = [
            MPNowPlayingInfoPropertyIsLiveStream: true,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
        ]
        if let track = reading?.track, reading?.onAir == true {
            info[MPMediaItemPropertyTitle] = track.title
            info[MPMediaItemPropertyArtist] = track.artist
            info[MPMediaItemPropertyAlbumTitle] = track.album ?? station
        } else {
            info[MPMediaItemPropertyTitle] = station
            info[MPMediaItemPropertyArtist] = String(localized: "Off air")
        }
        if let artwork {
            let held = HeldImage(image: artwork)
            // `@Sendable` so it does not inherit the main actor: MediaPlayer asks for the image from
            // its own thread, and an inherited main actor is checked at run time and crashes.
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: artwork.size) { @Sendable _ in held.image }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
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
