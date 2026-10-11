import AppIntents

/// What the station's intents do, in the app: act on `AppModel.shared`, the one graph in the process.
///
/// The intents themselves are in `Shared/StationIntents.swift`, compiled into the widget as well;
/// see the note there for why they run here whichever target pressed them. Do not build an
/// `AppModel` anywhere else: a second one would be a second player and a second listener.
@MainActor
enum StationControl {
    static func play() throws {
        let model = AppModel.shared
        // Nothing to play before a station is kept; say so rather than reporting a start.
        guard model.settings.settings.station != nil else { throw PlayStationError.noStation }
        model.listening.play()
    }

    static func stop() {
        AppModel.shared.listening.stop()
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
