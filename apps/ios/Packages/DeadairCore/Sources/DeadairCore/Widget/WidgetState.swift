import DeadairSdk
import Foundation

/// What this phone is doing about the station, as the widget needs it.
///
/// Three states rather than two, for the reason `apps/android`'s `WidgetPlayback` gives: the seconds
/// after a press are warm-up, and a widget that sat at "stopped" through them would look like the
/// press had not landed.
public enum WidgetPlayback: String, Codable, Hashable, Sendable {
    case stopped
    /// Asked for, and nothing coming out yet.
    case warmingUp
    case playing
}

/// From whether the app is asking for audio and whether audio is coming out, as every other button reads it.
public func widgetPlayback(requested: Bool, playing: Bool) -> WidgetPlayback {
    if !requested { return .stopped }
    return playing ? .playing : .warmingUp
}

/// Everything the widget draws from, and the whole of the file the app writes for it.
///
/// **Playing or stopped is on disk here, where Android keeps it in memory.** Android's widget is
/// drawn by the app's own process, which can ask its playback service; an iOS widget is drawn by an
/// extension that cannot ask the app anything, so whatever it needs to choose between Play and Stop
/// has to be in the file. A process that died writes nothing, which leaves a Stop button on a widget
/// whose audio has gone with it; pressing it runs `StopStationIntent` in a fresh app process, which
/// stops nothing and rewrites the file as stopped. That is the safe way round.
public struct WidgetState: Codable, Hashable, Sendable {
    public var snapshot: WidgetSnapshot
    public var playback: WidgetPlayback
    /// False until a station has been kept. The widget then says to choose one in the app.
    public var hasStation: Bool

    public init(snapshot: WidgetSnapshot = WidgetSnapshot(), playback: WidgetPlayback = .stopped, hasStation: Bool = false) {
        self.snapshot = snapshot
        self.playback = playback
        self.hasStation = hasStation
    }
}

/// Whether a new state is worth a file write and a reload: the snapshot's own rule, or a press.
public func worthDrawing(_ last: WidgetState, _ next: WidgetState, ageGap: TimeInterval = widgetAgeGap) -> Bool {
    last.playback != next.playback || last.hasStation != next.hasStation || worthDrawing(last.snapshot, next.snapshot, ageGap: ageGap)
}

/// The snapshot after the reading the app's screens draw has moved.
///
/// Fed `AppModel.heardState`, which is the gate's released reading while this phone plays and the
/// poll's otherwise, so the widget never names a record before the lock screen beside it does.
///
/// - Before the first answer nothing is known, and claiming otherwise would blank a widget that is
///   showing something true, so the last snapshot stands.
/// - A failed poll keeps the last good fields and their age, and only marks them: the age is the
///   age of the last thing the station SAID, so it does not move for a request that failed.
/// - An answer is a new snapshot, stamped `now`.
public func advance(_ last: WidgetSnapshot, heard: NowPlayingState, station: StationUrl?, stationName: String?, now: Date) -> WidgetSnapshot {
    switch heard {
    case .loading:
        return last
    case .unreachable:
        var kept = last
        kept.reachable = false
        return kept
    case .answered(let reading):
        return snapshotOf(reading.value, station: station, stationName: stationName, readAt: now)
    }
}

/// What the widget says.
///
/// Its own type rather than the lock screen's `LockScreenLines`, because the two surfaces answer
/// differently: a lock screen tile must have a title, so off air it borrows the station's name for
/// one, and a widget has a line of its own to put that in. `apps/android`'s `WidgetReading`.
public enum WidgetReading: Equatable, Sendable {
    /// Nothing has been chosen yet. The app is where a station is named, and tapping the widget opens it.
    case noStation
    /// Not listening, and nothing has been heard since the station was chosen. The widget asks the
    /// station nothing of its own, so it has nothing else to say.
    case resting
    case warmingUp
    /// The station is not airing anything, and this phone is not asking it to.
    case offAir
    /// The station is not answering what it is playing. The audio may well be fine.
    case unreachable
    case record(title: String, artist: String?)
    /// The station talking between records: `label` is the break's own name, `host` whoever is saying it.
    case spoken(host: String?, label: String)

    /// Whether this names something on air, which is when a cover belongs beside it.
    public var isOnAir: Bool {
        switch self {
        case .record, .spoken: true
        default: false
        }
    }
}

/// What to say, from the file.
///
/// The order is `airState`'s and for its reasons: a station that is not airing while this phone is
/// asking for audio is WARMING UP, never off air, because those are the same answer from the station
/// and what separates them is whether anybody here is asking it for anything.
///
/// **Stopped, it says what the app last heard, where Android's default says "Not listening".** An
/// iOS widget has no way to ask the station anything (there is no refresh of its own, as Android's
/// optional one is), so the only reading it can ever hold is one the app wrote, and that is shown
/// with its age once the age matters (`widgetAsOf`) rather than hidden.
public func widgetReading(_ state: WidgetState) -> WidgetReading {
    guard state.hasStation else { return .noStation }
    let snapshot = state.snapshot
    if state.playback == .stopped, snapshot.readAt == nil { return .resting }
    if !snapshot.reachable { return .unreachable }

    guard snapshot.onAir, let title = nonBlank(snapshot.title) else {
        return state.playback == .stopped ? .offAir : .warmingUp
    }
    if snapshot.kind == .break { return .spoken(host: nonBlank(snapshot.host), label: title) }
    return .record(title: title, artist: nonBlank(snapshot.artist))
}

/// When the reading on the widget was taken, if that is worth saying.
///
/// Only while nothing here is playing: the rest of the time the app is polling and what is drawn is
/// seconds old. Two minutes because a record is three, so an older reading is no longer safely "what
/// is playing", and a widget that names the wrong record with no hedge is worse than one that admits
/// its age. Android's `asOf`, with the same threshold.
public func widgetAsOf(_ state: WidgetState, now: Date) -> Date? {
    guard state.playback == .stopped, let readAt = state.snapshot.readAt else { return nil }
    return now.timeIntervalSince(readAt) >= widgetStaleAfter ? readAt : nil
}

/// When the widget should draw itself again with nothing new in the file: the moment its age starts
/// being shown. `nil` when no such moment is coming.
public func widgetRedrawAt(_ state: WidgetState, now: Date) -> Date? {
    guard state.playback == .stopped, let readAt = state.snapshot.readAt else { return nil }
    let stale = readAt.addingTimeInterval(widgetStaleAfter)
    return stale > now ? stale : nil
}

/// How old a reading gets before the widget says when it was taken.
public let widgetStaleAfter: TimeInterval = 120
