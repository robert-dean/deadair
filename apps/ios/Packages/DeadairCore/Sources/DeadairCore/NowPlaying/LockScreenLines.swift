import DeadairSdk

/// The three lines the lock screen, Control Center and a car show.
public struct LockScreenLines: Equatable, Sendable {
    public let title: Message
    public let artist: Message
    public let album: String?
}

/// What the lock screen says about a reading.
///
/// A record is its title over its artist, with its album (or the station's name) beneath. While the
/// station talks between records the artist is EMPTY, and a title over nothing looks like a tile
/// that failed to load; so the title says who is talking, the break's own label goes on the artist
/// line, and the show takes the album line. Off air, the station's name is the title and "Off air"
/// the line under it, which is what a lock screen should say about a radio that is quiet.
///
/// The same decision `apps/android`'s `lockScreenText` makes, here so a test can read it and the
/// words stay in `MessageWords`.
public func lockScreenLines(station: String, reading: NowPlaying?) -> LockScreenLines {
    guard let reading, reading.onAir, let track = reading.track else {
        return LockScreenLines(title: .text(station), artist: .offAir, album: nil)
    }
    if track.kind == .break {
        return LockScreenLines(title: .onTheMic(host: nonBlank(reading.show?.host)), artist: .text(track.title), album: nonBlank(reading.show?.name) ?? station)
    }
    return LockScreenLines(title: .text(track.title), artist: .text(track.artist), album: track.album ?? station)
}
