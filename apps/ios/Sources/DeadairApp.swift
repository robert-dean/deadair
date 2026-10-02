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

/// Setup when there is no station, the tabs when there is. Chosen above navigation rather than
/// pushed, so Setup is never a place back can reach: `apps/android` makes the same choice.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Group {
            if model.settings.settings.station == nil {
                // Keyed on the link, so a second one before the first was kept starts afresh.
                SetupScreen(proposed: model.proposed).id(model.proposed)
            } else {
                HomeTabs()
                    // A link to another station is asked over the app, which goes on as it was until
                    // the new address has answered and somebody has pressed Listen.
                    .sheet(item: Binding(get: { model.proposed.map(Proposal.init) }, set: { if $0 == nil { model.proposed = nil } })) { proposal in
                        ProposalSheet(proposed: proposal.station)
                    }
            }
        }
        .toasts()
        .onOpenURL { model.open($0) }
        // The first appearance, not every foregrounding (which is what `scenePhase` would give);
        // `OpenPlay` answers yes once per process however often this runs.
        .task { model.opened() }
        // Here rather than in Settings, so a role granted or taken away since the last run is
        // noticed before the screens that draw the operator's controls, not when Settings opens.
        .task(id: model.session.stored?.email) { await model.session.ensureRoles() }
    }
}
