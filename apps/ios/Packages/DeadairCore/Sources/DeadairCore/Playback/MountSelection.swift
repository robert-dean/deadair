import DeadairSdk

/// Which mount to play, and whether it is the one the listener asked for.
public struct MountChoice: Equatable, Sendable {
    public let path: String
    public let format: StreamFormat
    /// True when the chosen format was not available and MP3 was taken instead. Worth saying out loud.
    public let fellBack: Bool
}

/// Where a station publishes MP3, and the only sensible guess before it has answered.
public let defaultMount = "/live.mp3"

/// The mount to play, from what the station says it publishes.
///
/// The paths come from `/nowplaying`'s `mounts[]` rather than being derived here. They are fixed on
/// a current station, but an older one took the MP3 path from a setting an operator could rename,
/// and deriving them client-side would fail there in a way that looks like the stream being down.
///
/// MP3 is the floor because it is the only mount with no switch: the contract says the list is
/// never empty and MP3 is first. So a format the operator has turned off degrades to something
/// audible rather than to silence, and it says so, because a listener who chose FLAC and is
/// quietly given 128k MP3 has been lied to.
///
/// Nothing here connects to a mount to find out. Under `playout.airMode: audience` a connection is
/// an audience for the five-minute linger, so a probe would put a silent station on air.
public func chooseMount(_ mounts: [NowPlayingMount], wanted: StreamFormat) -> MountChoice {
    // Before the first reading there is nothing to choose from, and `/live.mp3` is where every
    // current station publishes MP3.
    guard !mounts.isEmpty else { return MountChoice(path: defaultMount, format: .mp3, fellBack: wanted != .mp3) }

    if let exact = mounts.first(where: { $0.format == wanted.wire }) {
        return MountChoice(path: exact.path, format: wanted, fellBack: false)
    }
    if let mp3 = mounts.first(where: { $0.format == .mp3 }) {
        return MountChoice(path: mp3.path, format: .mp3, fellBack: true)
    }
    // The contract says this cannot happen. If it ever does, the first mount the station named
    // beats refusing to play anything.
    let first = mounts[0]
    return MountChoice(path: first.path, format: StreamFormat(wire: first.format), fellBack: true)
}

/// Which formats the picker may offer, from what the station says it publishes.
///
/// Empty before any reading has arrived, which the picker reads as "offer everything": greying a
/// format out on no evidence is worse than offering one that turns out to be off, and choosing one
/// that is off falls back to MP3 and says so.
public func availableFormats(_ mounts: [NowPlayingMount]?) -> [StreamFormat: Bool] {
    guard let mounts else { return [:] }
    let published = Set(mounts.map(\.format))
    return Dictionary(uniqueKeysWithValues: StreamFormat.allCases.map { ($0, published.contains($0.wire)) })
}
