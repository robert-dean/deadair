/// What this install remembers about how to listen, as text in and text out.
///
/// Stored as separate strings rather than as one encoded blob so a value this build cannot read is
/// dropped on its own rather than taking the others with it: the desktop app once lost a station
/// address because the file it lived in also held an appearance its decoder did not know.
public struct ListenerSettings: Equatable, Sendable {
    /// The station, or `nil` when there is none, which is what sends the app to Setup.
    public var station: StationUrl?
    /// Kept so the title has a name before the first poll answers.
    public var stationName: String?
    /// The format the listener chose, or `nil` for Automatic, which is what nobody choosing gets;
    /// see `chooseMount`.
    public var format: StreamFormat?
    /// Start the station when the app opens. Off by default: opening an app is not always wanting
    /// to hear it.
    public var playOnOpen: Bool

    public init(station: StationUrl? = nil, stationName: String? = nil, format: StreamFormat? = nil, playOnOpen: Bool = false) {
        self.station = station
        self.stationName = stationName
        self.format = format
        self.playOnOpen = playOnOpen
    }

    /// Read the stored text. An address that no longer parses is treated as absent, so the app goes
    /// back to Setup rather than polling something it cannot reach; a format this build does not
    /// know is Automatic, as for somebody who never chose. Play-on-open is on only for the word `on`, so
    /// anything else, including nothing at all, is the default.
    public init(stationText: String?, nameText: String?, formatText: String?, playOnOpenText: String? = nil) {
        station = stationText.flatMap { try? StationUrl.parse($0).get() }
        stationName = station == nil ? nil : nameText
        format = formatText.flatMap(StreamFormat.init(rawValue:))
        playOnOpen = playOnOpenText == "on"
    }

    public var stationText: String? { station?.origin }
    /// `nil` for Automatic, which is stored as nothing at all.
    public var formatText: String? { format?.rawValue }

    /// The stored format as it reads now that Automatic exists, for an install that stored it
    /// before.
    ///
    /// Until then every save wrote the format, whichever setting changed, so a stored `mp3` cannot
    /// say whether anybody chose it, and the default was MP3. It is read as never chosen, once: a
    /// listener who did choose it finds Automatic and chooses again, which costs one tap, where
    /// the other reading would leave every install on MP3 and none of them on what survives a
    /// change of network. Any other format was a choice and is kept.
    public static func formatTextFromBeforeAutomatic(_ stored: String?) -> String? {
        stored == StreamFormat.mp3.rawValue ? nil : stored
    }
    public var playOnOpenText: String { playOnOpen ? "on" : "off" }
}
