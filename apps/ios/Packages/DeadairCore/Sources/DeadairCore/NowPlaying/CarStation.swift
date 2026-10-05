import DeadairSdk

/// The one row a car's screen offers: the station, and what is on it.
///
/// **There is exactly one, and it must never become two.** The station is a single live stream, not a
/// library. A second row (one per format, say) is a second thing to press, and it would put a
/// "next" in the car that is not the operator's Skip. `apps/android`'s Android Auto library holds one
/// item for the same reason, and `CarStationItem` has no list to grow: it is a value, not a collection.
public struct CarStationItem: Equatable, Sendable {
    /// The station's name, which is the row's title whatever is playing.
    public let name: String
    /// What is on, as lines for the row's subtitle: a record's title and artist, who is on the mic and
    /// the break's label, or nothing. Never more than two, and none until the listener is tuned in.
    public let lines: [Message]
    /// The picture beside it: the record's cover, or the presenter's portrait during a break.
    public let artworkUrl: String?
    /// Whether the app is asking for audio, which the row shows as the speaker.
    public let playing: Bool
    /// False until a station has been kept. The row then says where to choose one and pressing it
    /// plays nothing.
    public let canPlay: Bool
}

/// What the car's station row says.
///
/// The reading is the one the LOCK SCREEN is showing (held by `NowPlayingGate` until the audio has
/// reached it), so the car and the tile never disagree about which record is on. It says what is on
/// only while the listener is tuned in: a reading left over from before they pressed stop is not
/// what the station is playing, and a car should not claim it is. The lines are the lock screen's
/// own (`lockScreenLines`), minus the station's name, which is already the row's title.
///
/// Equatable on purpose. The listener count, the format and the playhead are not in it, so a poll
/// that moved only those leaves the row equal to what the car already shows and costs the car
/// nothing; the app redraws when the value changes and not otherwise.
public func carStationItem(station: StationUrl?, name: String?, reading: NowPlaying?, playing: Bool) -> CarStationItem {
    let title = nonBlank(name) ?? "deadair"
    guard let station else {
        return CarStationItem(name: title, lines: [.chooseStationOnPhone], artworkUrl: nil, playing: false, canPlay: false)
    }
    guard playing else {
        return CarStationItem(name: title, lines: [], artworkUrl: nil, playing: false, canPlay: true)
    }
    let lines: [Message]
    if reading?.onAir == true, reading?.track != nil {
        let said = lockScreenLines(station: title, reading: reading)
        lines = [said.title, said.artist]
    } else {
        lines = [.offAir]
    }
    return CarStationItem(name: title, lines: lines, artworkUrl: coverArtUrl(station: station, reading: reading), playing: true, canPlay: true)
}
