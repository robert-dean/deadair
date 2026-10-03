import AVFoundation
import Network
import SwiftUI
import UIKit

/// Everything in the app that exists on iOS and nowhere else, in one file.
///
/// Kept together so the rest of the app reads as plain SwiftUI and AVFoundation, and so it is
/// obvious where to look when an iOS release changes how audio sessions, background time or images
/// behave.
enum Platform {
    /// Where the session is activated and deactivated. `setActive` waits on the media server, and
    /// on the main thread iOS reports it as a hang risk on every play and stop. Serial, so a stop
    /// pressed straight after a play deactivates after the activation rather than before it.
    private static let audioSessionQueue = DispatchQueue(label: "com.maroonedsoftware.deadair.audio-session")

    /// Claim audio output for playback, the way a music app does: other audio stops, and the
    /// silent switch does not mute the station.
    ///
    /// The category is set before this returns, so a player that starts before the activation
    /// lands activates the session itself under `.playback` rather than under the default category,
    /// which the silent switch mutes.
    static func activateAudio() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        audioSessionQueue.async {
            try? AVAudioSession.sharedInstance().setActive(true)
        }
    }

    /// Give audio output back, and tell whatever was playing before that it may resume.
    static func deactivateAudio() {
        audioSessionQueue.async {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
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

    /// Report the phone's network, on the main actor, for as long as the returned monitor is kept:
    /// the interface a new connection would go out on (`en0` for wifi, `pdp_ip0` for mobile data),
    /// or `nil` for none. Cancel it to stop.
    ///
    /// The interface rather than a network, because a path has no handle for one; so a move between
    /// two wifi networks reads as no move at all, and is left to fail and be retried as it always
    /// was. A satisfied path, not one known to reach the internet: a station on the home network is
    /// reached over a wifi that may have nothing behind it. The handler is `@Sendable` because the
    /// monitor calls it on its own queue; see the note on `StationPlayer.watch` for what happens to
    /// a main-actor closure that is not.
    @MainActor
    static func observeNetwork(_ handle: @escaping @MainActor (String?) -> Void) -> NWPathMonitor {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { @Sendable path in
            // Preference order, so the first is the one a new connection takes.
            let network = path.status == .satisfied ? path.availableInterfaces.first?.name : nil
            Task { @MainActor in handle(network) }
        }
        monitor.start(queue: DispatchQueue(label: "com.maroonedsoftware.deadair.network"))
        return monitor
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

extension Platform {
    /// A cover's main colours, most common first, for `CoverPalette` to choose from.
    ///
    /// The picture is drawn down to 24 by 24 and its pixels counted in coarse buckets, which is enough
    /// to find what a cover is mostly made of and cheap enough to do once per record. A bucket's colour
    /// is the average of the pixels in it rather than its corner, so a cover's green stays its green.
    static func coverColors(_ image: PlatformImage, count: Int = 6) -> [UInt32] {
        guard let cg = image.cgImage else { return [] }
        let side = 24
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.interpolationQuality = .medium
            context.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
            return true
        }
        guard drawn else { return [] }
        var buckets: [Int: (count: Int, r: Int, g: Int, b: Int)] = [:]
        for i in stride(from: 0, to: pixels.count, by: 4) where pixels[i + 3] > 128 {
            let r = Int(pixels[i]), g = Int(pixels[i + 1]), b = Int(pixels[i + 2])
            let key = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5)
            let old = buckets[key] ?? (0, 0, 0, 0)
            buckets[key] = (old.count + 1, old.r + r, old.g + g, old.b + b)
        }
        return buckets.values
            .sorted { $0.count > $1.count }
            .prefix(count)
            .map { UInt32($0.r / $0.count) << 16 | UInt32($0.g / $0.count) << 8 | UInt32($0.b / $0.count) }
    }
}

extension Image {
    init(platformImage: PlatformImage) {
        self.init(uiImage: platformImage)
    }
}
