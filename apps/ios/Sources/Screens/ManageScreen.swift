import DeadairCore
import DeadairSdk
import SwiftUI

/// The station's controls from Up next, in one place.
///
/// Each is a row in a group that says what it acts on, and each row says in words what it does. A
/// signed-in listener who is not the operator gets the one read they are allowed, What it said, and
/// nothing that would be refused. `apps/android`'s `ManageScreen`.
struct ManageScreen: View {
    @Environment(AppModel.self) private var model
    /// One request at a time: the station absorbs a second press of the same kind anyway, and rows
    /// that grey while it asks are what tell the operator the first one was heard.
    @State private var asking = false

    var body: some View {
        let order = model.order.state(signedIn: model.signedIn)
        let reading: OrderReading? = if case .loaded(let reading, _) = order { reading } else { nil }
        // Only for the brief and whether anything is on: who presents it is changed on Up next, where it is read.
        let broadcast = reading.map { BroadcastUiState(order: $0.order, personas: nil) }

        List {
            if model.isOperator {
                Section(String(localized: "This show")) {
                    NavigationLink(value: PageRoute.plan(currentBrief: reading?.order.brief, somethingOn: broadcast?.nothingOn == false)) {
                        row(String(localized: "Replan the show"), detail: broadcast?.brief.map { Message.askedFor($0).words })
                    }
                }
                // Always offered: off air it is the way on.
                Section(String(localized: "Put something on")) {
                    NavigationLink(value: PageRoute.airSomething) { row(String(localized: "Playlists"), detail: nil) }
                    // Off air, a playlist is the way on: there is no broadcast for one record to join.
                    if broadcast?.nothingOn == false {
                        NavigationLink(value: PageRoute.addRecord) { row(String(localized: "Add a record"), detail: nil) }
                    }
                }
                // Off air the station declines every break, since there is no running order to put one in.
                if broadcast?.nothingOn == false {
                    Section(String(localized: "Say something")) {
                        say(.news, String(localized: "The news"))
                        say(.weather, String(localized: "The weather"))
                        say(.talkbreak, String(localized: "A word from the host"))
                    }
                }
            }
            if model.signedIn {
                Section(String(localized: "What it said")) {
                    NavigationLink(value: PageRoute.scripts(segmentId: nil)) {
                        row(String(localized: "What it said"), detail: String(localized: "Every break's script, and what became of it"))
                    }
                }
            }
        }
        .navigationTitle(String(localized: "Manage"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.order.hold() }
    }

    private func say(_ kind: RequestableBreakKind, _ title: String) -> some View {
        Button {
            asking = true
            Task {
                await model.breakActions.request(kind)
                asking = false
            }
        } label: {
            row(title, detail: String(localized: "After this record, once it is written")).foregroundStyle(asking ? Color.secondary : Color.primary)
        }
        .disabled(asking)
    }

    private func row(_ title: String, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            if let detail { Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(2) }
        }
    }
}
