import DeadairSdk
import Foundation

/// What the station was doing when this phone last heard from it, as the home-screen widget draws it.
///
/// **A widget is not a process.** What the home screen shows was drawn by an extension that may be
/// long gone, and it draws again when iOS says so rather than when the station moves. So the app
/// writes this to a file the widget can read, and the widget draws the file. `apps/android`'s
/// `WidgetSnapshot`, field for field.
///
/// Deliberately smaller than the reading it comes from: no mounts, no listener count, no playhead.
/// A widget shows none of them, and what is written to the shared container is what `PRIVACY.md`
/// has to account for.
public struct WidgetSnapshot: Codable, Equatable, Sendable {
    /// What the station calls itself, which is drawn before any reading has arrived and while it is unreachable.
    public var stationName: String?
    public var onAir: Bool
    /// False once a poll has failed. The last good fields are kept, exactly as `PollState.unreachable` keeps them.
    public var reachable: Bool
    public var kind: NowPlayingTrackKind?
    public var title: String?
    public var artist: String?
    /// Who is talking, when the station is talking. Absent for a record, and for an unnamed host.
    public var host: String?
    /// The picture the reading names, resolved against the station: the cover, or the presenter's portrait during a break.
    public var artworkUrl: String?
    /// Wall-clock, because the age of this is shown to a person and has to survive a reboot. `nil` before any reading.
    public var readAt: Date?

    public init(
        stationName: String? = nil,
        onAir: Bool = false,
        reachable: Bool = true,
        kind: NowPlayingTrackKind? = nil,
        title: String? = nil,
        artist: String? = nil,
        host: String? = nil,
        artworkUrl: String? = nil,
        readAt: Date? = nil
    ) {
        self.stationName = stationName
        self.onAir = onAir
        self.reachable = reachable
        self.kind = kind
        self.title = title
        self.artist = artist
        self.host = host
        self.artworkUrl = artworkUrl
        self.readAt = readAt
    }

    /// Everything that is drawn, with the age left out: what `worthDrawing` compares.
    var drawn: WidgetSnapshot {
        var copy = self
        copy.readAt = nil
        return copy
    }
}

/// The snapshot a reading makes, given the station it came from and what the settings call it.
///
/// Only ever built from an answer. A poll that FAILED does not come through here: the last good
/// fields are kept and only `reachable` is turned over, because blanking the widget for one failed
/// request would make every hiccup look like the station going away, and because the age shown
/// beside it is the age of the last thing the station actually said.
public func snapshotOf(_ now: NowPlaying, station: StationUrl?, stationName: String?, readAt: Date) -> WidgetSnapshot {
    let track = now.track
    return WidgetSnapshot(
        // The station's own name wins over the one setup kept: it is the newer answer.
        stationName: nonBlank(now.station) ?? stationName,
        onAir: now.onAir,
        reachable: true,
        kind: track?.kind,
        title: track?.title,
        artist: nonBlank(track?.artist),
        host: nonBlank(now.show?.host),
        artworkUrl: coverArtUrl(station: station, reading: now),
        readAt: readAt
    )
}

/// Whether a new snapshot is worth a file write and a reload.
///
/// The poll answers every three seconds, and a widget whose file was rewritten each time would be a
/// write and a timeline reload every three seconds for a picture nobody may be looking at. Only what
/// is DRAWN counts, so a moved listener count changes nothing, which leaves the age; the age is shown
/// to the minute, so it earns a write once a minute at most.
public func worthDrawing(_ last: WidgetSnapshot, _ next: WidgetSnapshot, ageGap: TimeInterval = widgetAgeGap) -> Bool {
    if last.drawn != next.drawn { return true }
    guard let readAt = next.readAt else { return false }
    guard let before = last.readAt else { return true }
    return readAt.timeIntervalSince(before) >= ageGap
}

/// How stale the kept age may get before it is rewritten for its own sake. The label it feeds is in minutes.
public let widgetAgeGap: TimeInterval = 60
