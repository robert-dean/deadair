import SwiftUI

@main
struct DeadairApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
    }
}

/// Setup when there is no station, the player when there is. Chosen above navigation rather than
/// pushed, so Setup is never a place back can reach: `apps/android` makes the same choice.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.settings.settings.station == nil {
                SetupScreen()
            } else {
                NavigationStack {
                    NowPlayingScreen()
                }
            }
        }
        .operatorNotices()
        // The first appearance, not every foregrounding (which is what `scenePhase` would give);
        // `OpenPlay` answers yes once per process however often this runs.
        .task { model.opened() }
        // Here rather than in Settings, so a role granted or taken away since the last run is
        // noticed before the screens that draw the operator's controls, not when Settings opens.
        .task(id: model.session.stored?.email) { await model.session.ensureRoles() }
    }
}
