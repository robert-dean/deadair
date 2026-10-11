// ActivityKit is iOS-only; see `Shared/StationActivityAttributes.swift`.
#if os(iOS)
import ActivityKit
import DeadairCore
import Foundation
import Observation

/// The Live Activity while the station plays: started on play, updated from the released reading,
/// ended on stop. When to do each is `DeadairCore`'s `stationActivityStep`; this type carries it out.
///
/// **Local updates only, never a push.** The app is running for as long as it plays (background
/// audio), and that is the only time the activity exists, so there is nothing a server would need to
/// tell it. No APNs, no push token, nothing new for `PRIVACY.md`.
///
/// **It reads what the widget reads**: `AppModel.heardState`, so the activity changes record when the
/// lock screen's own tile does, and holds no lease of its own.
///
/// **A start can fail, and that is ordinary.** iOS lets an app start an activity only from the
/// foreground, so a play from the lock screen tile, a widget or Siri while the app is in the
/// background starts none; the next change after the app comes forward tries again.
@MainActor
final class StationActivityFeed {
    struct Inputs {
        let widget: WidgetFeed.Inputs
        /// The setting, "Show on the Lock Screen".
        let enabled: Bool
        /// Projected from the same released reading as `widget.heard`, or `nil` when the station did not say.
        let playhead: Playhead?
    }

    private let read: @MainActor () -> Inputs
    /// The id of the activity this process started, `nil` while there is none.
    private var activity: String?
    /// What the activity was last given, `nil` while there is none.
    private var running: StationActivityContent?
    private var snapshot = WidgetSnapshot()
    /// Updates and ends, one after another, so an end can never overtake the update before it.
    private var queue: Task<Void, Never>?
    private var started = false

    init(read: @escaping @MainActor () -> Inputs) {
        self.read = read
    }

    func start() {
        guard !started else { return }
        started = true
        // An activity left by a process that was killed while playing describes audio that died with
        // it. This process is not playing yet, so whatever is there is ended. By id, taken now, so an
        // activity this process starts before the ending runs is not caught in it.
        let leftovers = Activity<StationActivityAttributes>.activities.map(\.id)
        queue = Task { await Self.end(leftovers) }
        follow()
    }

    private func follow() {
        let inputs = withObservationTracking {
            read()
        } onChange: { [weak self] in
            Task { @MainActor in self?.follow() }
        }
        moved(inputs)
    }

    private func moved(_ inputs: Inputs) {
        let widget = inputs.widget
        if widget.requested {
            snapshot = advance(snapshot, heard: widget.heard, station: widget.station, stationName: widget.stationName, now: Date())
            if snapshot.stationName == nil { snapshot.stationName = widget.stationName }
        } else {
            // The next start begins from whatever is heard then, not from the last session's record.
            snapshot = WidgetSnapshot(stationName: widget.stationName)
        }
        let state = WidgetState(snapshot: snapshot, playback: widgetPlayback(requested: widget.requested, playing: widget.playing), hasStation: widget.station != nil)
        let next = stationActivityContent(state, playhead: inputs.playhead, now: Date())
        let enabled = inputs.enabled && ActivityAuthorizationInfo().areActivitiesEnabled

        switch stationActivityStep(enabled: enabled, requested: widget.requested, running: running, next: next) {
        case .none:
            break
        case .start(let content):
            activity = (try? Activity.request(attributes: StationActivityAttributes(), content: ActivityContent(state: content, staleDate: nil)))?.id
            // Refused (the app is in the background, most often): nothing is running, so the next
            // change asks again rather than updating an activity that does not exist.
            running = activity == nil ? nil : content
        case .update(let content):
            running = content
            guard let id = activity else { return }
            enqueue { await Self.update(id, content) }
        case .end:
            running = nil
            guard let id = activity else { return }
            activity = nil
            enqueue { await Self.end([id]) }
        }
    }

    private func enqueue(_ work: @escaping @Sendable () async -> Void) {
        let previous = queue
        queue = Task {
            await previous?.value
            await work()
        }
    }

    // The activity is found again by its id off the main actor rather than carried there: an
    // `Activity` is not `Sendable`, and handing one from the main actor to its own async methods
    // does not compile under strict concurrency.
    private nonisolated static func update(_ id: String, _ content: StationActivityContent) async {
        guard let activity = Activity<StationActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
        await activity.update(ActivityContent(state: content, staleDate: nil))
    }

    private nonisolated static func end(_ ids: [String]) async {
        for activity in Activity<StationActivityAttributes>.activities where ids.contains(activity.id) {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
#endif
