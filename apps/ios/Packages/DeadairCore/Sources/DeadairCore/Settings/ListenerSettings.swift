/// What this install remembers about how to listen, as text in and text out.
///
/// Stored as three strings rather than as one encoded blob so a value this build cannot read is
/// dropped on its own rather than taking the others with it: the desktop app once lost a station
/// address because the file it lived in also held an appearance its decoder did not know.
public struct ListenerSettings: Equatable, Sendable {
    /// The station, or `nil` when there is none, which is what sends the app to Setup.
    public var station: StationUrl?
    /// Kept so the title has a name before the first poll answers.
    public var stationName: String?
    public var format: StreamFormat

    public init(station: StationUrl? = nil, stationName: String? = nil, format: StreamFormat = .mp3) {
        self.station = station
        self.stationName = stationName
        self.format = format
    }

    /// Read the stored text. An address that no longer parses is treated as absent, so the app goes
    /// back to Setup rather than polling something it cannot reach; a format this build does not
    /// know is MP3, which every station publishes.
    public init(stationText: String?, nameText: String?, formatText: String?) {
        station = stationText.flatMap { try? StationUrl.parse($0).get() }
        stationName = station == nil ? nil : nameText
        format = formatText.flatMap(StreamFormat.init(rawValue:)) ?? .mp3
    }

    public var stationText: String? { station?.origin }
    public var formatText: String { format.rawValue }
}
