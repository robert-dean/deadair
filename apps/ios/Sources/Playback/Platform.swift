import AVFoundation
import SwiftUI
import UIKit

/// Everything in the app that exists on iOS and nowhere else, in one file.
///
/// Kept together so the rest of the app reads as plain SwiftUI and AVFoundation, and so it is
/// obvious where to look when an iOS release changes how audio sessions, background time or images
/// behave.
enum Platform {
    /// Claim audio output for playback, the way a music app does: other audio stops, and the
    /// silent switch does not mute the station.
    static func activateAudio() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
    }

    /// Give audio output back, and tell whatever was playing before that it may resume.
    static func deactivateAudio() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// What the audio session reports that the player itself does not.
    enum AudioEvent: Sendable {
        /// A call, an alarm, Siri: something else took the audio.
        case interrupted
        /// It gave the audio back, and says whether playing again is expected.
        case interruptionEnded(shouldResume: Bool)
        /// The headphones came out, or the Bluetooth device went away.
        case outputLost
        /// The media server restarted, and every player built before it is dead.
        case reset
    }

    /// Deliver audio-session events on the main actor for as long as the returned tokens are kept.
    @MainActor
    static func observeAudio(_ handle: @escaping @MainActor (AudioEvent) -> Void) -> [NSObjectProtocol] {
        let centre = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        return [
            centre.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { note in
                let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:))
                let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
                let event: AudioEvent? = switch type {
                case .began: .interrupted
                case .ended: .interruptionEnded(shouldResume: options.contains(.shouldResume))
                default: nil
                }
                guard let event else { return }
                MainActor.assumeIsolated { handle(event) }
            },
            centre.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { note in
                let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
                guard reason == .oldDeviceUnavailable else { return }
                MainActor.assumeIsolated { handle(.outputLost) }
            },
            centre.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main) { _ in
                MainActor.assumeIsolated { handle(.reset) }
            },
        ]
    }

    /// Ask for a little time to finish something after the app leaves the screen, and hand back
    /// what ends it. iOS suspends an app that is not playing audio about thirty seconds after it
    /// goes to the background; a reconnect scheduled after a drop is exactly such an app.
    @MainActor
    static func beginBackgroundWork(_ name: String) -> @MainActor () -> Void {
        let work = BackgroundWork()
        work.identifier = UIApplication.shared.beginBackgroundTask(withName: name) {
            // iOS calls this on the main thread when the time is up.
            MainActor.assumeIsolated { work.end() }
        }
        return { work.end() }
    }

    @MainActor
    private final class BackgroundWork {
        var identifier = UIBackgroundTaskIdentifier.invalid

        func end() {
            guard identifier != .invalid else { return }
            UIApplication.shared.endBackgroundTask(identifier)
            identifier = .invalid
        }
    }
}

typealias PlatformImage = UIImage

extension Image {
    init(platformImage: PlatformImage) {
        self.init(uiImage: platformImage)
    }
}
