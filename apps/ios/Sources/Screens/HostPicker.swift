import DeadairCore
import DeadairSdk
import SwiftUI

/// Who presents this show, as a sheet of choices.
///
/// One question with a list of answers, so radio rows rather than a menu of buttons: which
/// one is presenting now is as much the point as which ones could. The first row hands the broadcast
/// back to whoever the station has on air, which is a real answer rather than the absence of one.
/// `apps/android`'s `HostPicker`.
struct HostPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let broadcast: BroadcastUiState
    @State private var busy = false

    var body: some View {
        // A sheet from the bottom with the question, what answering it does, and the answers: Android's
        // bottom sheet. Pulled down to close; there is nothing to cancel, since nothing changes until
        // a row is picked.
        VStack(alignment: .leading, spacing: 8) {
            Text(String(localized: "Who presents this show")).font(.headline)
            Text(String(localized: "Changing this re-writes the breaks already written for it, and one that is not ready when its slot comes round is skipped."))
                .font(.footnote)
                .foregroundStyle(.secondary)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    row(name: String(localized: "The station's host"), supporting: broadcast.stationsOwnName, selected: broadcast.order.personaId == nil,
                        enabled: broadcast.stationsOwnEnabled) { pick(nil) }
                    ForEach(broadcast.hostChoiceList, id: \.id) { choice in
                        row(name: choice.onAir ? String(localized: "\(choice.name) (on air)") : choice.name, supporting: choice.djName,
                            selected: choice.current, enabled: !choice.current) { pick(choice.id) }
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .disabled(busy)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    /// A radio row: the ring filled on the one presenting.
    private func row(name: String, supporting: String?, selected: Bool, enabled: Bool, pick: @escaping () -> Void) -> some View {
        Button(action: pick) {
            HStack(spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.title3)
                    .foregroundStyle(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).foregroundStyle(enabled || selected ? .primary : .secondary)
                    if let supporting { Text(supporting).font(.footnote).foregroundStyle(.secondary) }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
