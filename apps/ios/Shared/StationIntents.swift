import AppIntents

// This folder is compiled into the app AND the widget extension, because a widget's `Button(intent:)`
// can only name an intent its own module declares. Both intents still run in the APP: an
// `AudioPlaybackIntent` is performed in the app's own process, launching it in the background if need
// be, whichever target pressed it. So `perform()` calls `StationControl`, which each target declares
// for itself: the app's (`Sources/Intents/StationControl.swift`) acts on `AppModel.shared`, and the
// widget's exists only so this file compiles there.

/// Starts the station: from Siri, a Shortcut, the Action button, the widget, or a car that asks for it.
///
/// **An `AudioPlaybackIntent` is the one route that starts a swiped-away app.** A lock-screen tile
/// dies with the process, and iOS has no `MediaButtonReceiver` to relaunch it for a play press. The
/// system runs this intent in the app's own process, launching it in the background if need be, and
/// grants the audio session the app is about to open.
///
/// **It reuses the listener's play path and builds nothing of its own.** `AppModel.shared` is the
/// one graph the screens and the CarPlay scene use as well, so a second player cannot exist, and
/// `Listening.play()` is the call the Play button makes, with the same warm-up, lease and lock screen.
struct PlayStationIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play the station"
    static let description = IntentDescription("Puts the station on and starts listening.")

    @MainActor
    func perform() async throws -> some IntentResult {
        try StationControl.play()
        return .result()
    }
}

/// Stops the station, from the widget or the Live Activity: `Listening.stop()`, which drops the
/// connection rather than pausing it, as every other stop in the app does.
struct StopStationIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Stop the station"
    static let description = IntentDescription("Stops listening, and lets the station go off air if nobody else is.")

    @MainActor
    func perform() async throws -> some IntentResult {
        StationControl.stop()
        return .result()
    }
}

enum PlayStationError: Error, CustomLocalizedStringResourceConvertible {
    case noStation

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .noStation: "Open deadair and choose a station first."
        }
    }
}
