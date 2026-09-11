import DeadairCore
import Observation
import SwiftUI

/// The address field's state, and the one thing it does: ask the address whether it is a station.
@MainActor
@Observable
final class StationEntry {
    private(set) var state: StationEntryState

    init(stored: String?) {
        state = .typing(stored ?? "", stored: stored)
    }

    func type(_ address: String) {
        state = .typing(address, stored: state.stored)
    }

    func check(with model: AppModel) async {
        guard let station = state.parsed else {
            state = .invalid(state.address, stored: state.stored)
            return
        }
        state.checking = true
        let answer = await model.probe(station)
        state = .from(state.address, check: answer, stored: state.stored)
    }
}

/// The address field, as Setup and Settings both draw it: the field, what the station said back,
/// and a button that checks until the address has answered and keeps it once it has.
struct AddressField: View {
    @Environment(AppModel.self) private var model
    @Bindable var entry: StationEntry

    var body: some View {
        TextField(text: Binding(get: { entry.state.address }, set: { entry.type($0) }), prompt: Text(verbatim: "radio.example.com")) {
            Text("Station address")
        }
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textContentType(.URL)
            .submitLabel(.go)
            .onSubmit { Task { await entry.check(with: model) } }

        if let note = entry.state.supportingText {
            Text(note.words)
                .font(.footnote)
                .foregroundStyle(entry.state.error == nil ? Color.secondary : Color.red)
        }

        if let name = entry.state.confirmedName, let station = entry.state.parsed {
            Button(String(localized: "Listen to \(name)")) { model.keep(station, name: name) }
                .buttonStyle(.borderedProminent)
        } else if entry.state.showsCheck {
            Button {
                Task { await entry.check(with: model) }
            } label: {
                if entry.state.checking { ProgressView() } else { Text("Check") }
            }
            .disabled(entry.state.checking || entry.state.address.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}
