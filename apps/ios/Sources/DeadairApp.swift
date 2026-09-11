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
        if model.settings.settings.station == nil {
            SetupScreen()
        } else {
            NavigationStack {
                NowPlayingScreen()
            }
        }
    }
}
