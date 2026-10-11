import DeadairCore
import Foundation

/// The widget's words, in the phone's own language.
///
/// The app's `MessageWords` is not compiled here, so the widget resolves its own reading, with an
/// exhaustive `switch` so a reading without words is a compile error rather than an English fallback.
/// `Record` and `Spoken` carry words the STATION sent, which are passed through untranslated. The
/// sentences match the app's own where the two say the same thing.
extension WidgetReading {
    func heading(stationName: String?) -> String {
        let station = stationName ?? "deadair"
        switch self {
        case .noStation: return "deadair"
        case .resting, .warmingUp, .unreachable, .offAir: return station
        case .record(let title, _): return title
        case .spoken(let host?, _): return String(localized: "\(host) is on the mic")
        case .spoken(nil, _): return String(localized: "The host is on the mic")
        }
    }

    /// The line under the heading.
    var under: String? {
        switch self {
        case .noStation: String(localized: "Choose a station in the app")
        case .resting: String(localized: "Not listening")
        case .warmingUp: String(localized: "Coming on air")
        case .unreachable: String(localized: "Can't reach the station")
        case .offAir: String(localized: "Off air")
        case .record(_, let artist): artist
        case .spoken(_, let label): label
        }
    }
}
