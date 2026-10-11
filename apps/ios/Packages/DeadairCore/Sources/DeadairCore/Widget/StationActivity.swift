import Foundation

/// What the Live Activity on the Lock Screen and in the Dynamic Island draws: the widget's own state,
/// minus its age, plus the record's playhead as two wall-clock moments when it is known.
///
/// The widget's state rather than a second shape, so the two surfaces say the same words about the
/// same reading (`widgetReading`). The age is left out because the activity exists only while this
/// phone plays, when the reading is seconds old, and a field that moved every minute would be an
/// update every minute for nothing on screen. `ActivityAttributes.ContentState` in the app and the
/// extension is this type, which is why it is `Codable` and `Hashable`.
public struct StationActivityContent: Codable, Hashable, Sendable {
    public var state: WidgetState
    /// When the record began and ends, for `ProgressView(timerInterval:)`, which moves on its own
    /// between updates. Both `nil` unless the station said how much is left: `Playhead.project`
    /// refuses to guess, and so does this.
    public var playheadStart: Date?
    public var playheadEnd: Date?

    public init(state: WidgetState, playheadStart: Date? = nil, playheadEnd: Date? = nil) {
        self.state = state
        self.playheadStart = playheadStart
        self.playheadEnd = playheadEnd
    }
}

/// The content for a state and the playhead projected from the same released reading.
///
/// The playhead is kept only while the reading names something on air: a bar under "Coming on air"
/// would be measuring a record nobody can hear yet.
public func stationActivityContent(_ state: WidgetState, playhead: Playhead?, now: Date) -> StationActivityContent {
    var drawn = state
    drawn.snapshot.readAt = nil
    guard let playhead, widgetReading(state).isOnAir else { return StationActivityContent(state: drawn) }
    let end = now.addingTimeInterval(Double(playhead.remainingMs) / 1000)
    let start = end.addingTimeInterval(-Double(playhead.durationMs) / 1000)
    return StationActivityContent(state: drawn, playheadStart: start, playheadEnd: end)
}

/// What to do with the Live Activity.
public enum StationActivityStep: Equatable, Sendable {
    case none
    case start(StationActivityContent)
    case update(StationActivityContent)
    case end
}

/// Start, update or end the Live Activity, from whether it is wanted and what it shows now.
///
/// - **It lives exactly while this phone asks for audio**, and only with the setting on. Stop, the
///   sleep timer and a change of station all come through `Listening.stop()`, so they all end it here.
/// - **An update only when something drawn moved.** The poll answers every three seconds, and each
///   answer re-anchors the playhead by a few milliseconds; an update for that would spend the
///   system's budget on nothing, so the playhead counts only when it moved by `playheadSlack`.
/// - `running` is what the activity was last given, `nil` when there is none.
public func stationActivityStep(enabled: Bool, requested: Bool, running: StationActivityContent?, next: StationActivityContent) -> StationActivityStep {
    guard enabled, requested else { return running == nil ? .none : .end }
    guard let running else { return .start(next) }
    return worthUpdating(running, next) ? .update(next) : .none
}

/// Whether the activity's content moved enough to be worth an update.
public func worthUpdating(_ last: StationActivityContent, _ next: StationActivityContent, playheadSlack: TimeInterval = playheadSlack) -> Bool {
    if last.state != next.state { return true }
    return moved(last.playheadStart, next.playheadStart, slack: playheadSlack) || moved(last.playheadEnd, next.playheadEnd, slack: playheadSlack)
}

/// How far the playhead's ends may drift before it is worth telling the activity: a bar re-anchored
/// by less than this is the same bar.
public let playheadSlack: TimeInterval = 2

private func moved(_ a: Date?, _ b: Date?, slack: TimeInterval) -> Bool {
    switch (a, b) {
    case (nil, nil): false
    case let (a?, b?): abs(a.timeIntervalSince(b)) >= slack
    default: true
    }
}
