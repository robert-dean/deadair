// ActivityKit is iOS-only, and the app's files outside `Playback/Platform.swift` compile for the Mac,
// which is what lets the app be type-checked there; this file keeps that true by being absent there.
#if os(iOS)
import ActivityKit
import DeadairCore

/// The station's Live Activity, as the app starts it and the extension draws it.
///
/// In `Shared/` because both targets must name the same type: the app requests and updates it, and
/// the widget extension's `ActivityConfiguration` draws it. Everything it shows is the content state,
/// `DeadairCore`'s `StationActivityContent`, so a renamed station or a new record is an update rather
/// than a new activity, and the attributes themselves carry nothing.
struct StationActivityAttributes: ActivityAttributes {
    typealias ContentState = StationActivityContent
}
#endif
