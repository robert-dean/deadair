import AppIntents

/// Starts the station: from Siri, a Shortcut, the Action button, or a car that asks for it.
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
        let model = AppModel.shared
        // Nothing to play before a station is kept; say so rather than reporting a start.
        guard model.settings.settings.station != nil else { throw PlayStationError.noStation }
        model.listening.play()
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

/// What Siri and Shortcuts offer without the listener setting anything up.
struct DeadairShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: PlayStationIntent(),
            phrases: ["Play \(.applicationName)", "Put \(.applicationName) on", "Listen to \(.applicationName)"],
            shortTitle: "Play the station",
            systemImageName: "play.fill"
        )
    }
}
