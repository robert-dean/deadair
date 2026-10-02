import DeadairCore
import DeadairSdk
import SwiftUI

/// Who presents this show, as a sheet of choices.
///
/// One question with a list of answers, so a row per answer with a check on the one presenting: which
/// one is presenting now is as much the point as which ones could. The first row hands the broadcast
/// back to whoever the station has on air, which is a real answer rather than the absence of one.
/// `apps/android`'s `HostPicker`.
struct HostPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let broadcast: BroadcastUiState
    @State private var busy = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    row(name: String(localized: "The station's host"), supporting: broadcast.stationsOwnName, selected: broadcast.order.personaId == nil,
                        enabled: broadcast.stationsOwnEnabled) { pick(nil) }
                    ForEach(broadcast.hostChoiceList, id: \.id) { choice in
                        row(name: choice.onAir ? String(localized: "\(choice.name) (on air)") : choice.name, supporting: choice.djName,
                            selected: choice.current, enabled: !choice.current) { pick(choice.id) }
                    }
                } footer: {
                    Text(String(localized: "Changing this re-writes the breaks already written for it, and one that is not ready when its slot comes round is skipped."))
                }
            }
            .navigationTitle(String(localized: "Who presents this show"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Cancel")) { dismiss() }
                }
            }
            .disabled(busy)
        }
    }

    private func row(name: String, supporting: String?, selected: Bool, enabled: Bool, pick: @escaping () -> Void) -> some View {
        Button(action: pick) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).foregroundStyle(enabled || selected ? .primary : .secondary)
                    if let supporting { Text(supporting).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
        }
        .disabled(!enabled)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// The sheet closes once the station has taken the change: a sheet that closed first would leave a
    /// refusal to be said to a screen that had already moved on.
    private func pick(_ personaId: String?) {
        busy = true
        Task {
            if await model.orderActions.recast(personaId) { dismiss() }
            busy = false
        }
    }
}
