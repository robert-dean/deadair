import DeadairCore
import Foundation
import Observation

/// What this install remembers about how to listen, in `UserDefaults`.
///
/// Three keys rather than one encoded value, so a value this build cannot read is dropped on its
/// own; `ListenerSettings` decides what an unreadable one means. The session is NOT here: it lives in
/// the Keychain with a different lifetime, and clearing one must never be able to take the other.
@MainActor
@Observable
final class SettingsStore {
    private(set) var settings: ListenerSettings

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        settings = ListenerSettings(
            stationText: defaults.string(forKey: Keys.station),
            nameText: defaults.string(forKey: Keys.name),
            formatText: defaults.string(forKey: Keys.format)
        )
    }

    /// Keep a station that has answered, and the name it answered with.
    func keep(_ station: StationUrl, name: String) {
        settings.station = station
        settings.stationName = name
        write()
    }

    /// The name the station calls itself now, so the title matches before the next launch.
    func rename(_ name: String) {
        guard settings.station != nil, settings.stationName != name else { return }
        settings.stationName = name
        write()
    }

    func choose(_ format: StreamFormat) {
        settings.format = format
        write()
    }

    private func write() {
        defaults.set(settings.stationText, forKey: Keys.station)
        defaults.set(settings.stationName, forKey: Keys.name)
        defaults.set(settings.formatText, forKey: Keys.format)
    }

    private enum Keys {
        static let station = "station_url"
        static let name = "station_name"
        static let format = "stream_format"
    }
}
