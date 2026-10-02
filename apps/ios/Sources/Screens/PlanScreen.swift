import DeadairCore
import DeadairSdk
import SwiftUI

/// Planning the station: replan this show from here on, or start a new one.
///
/// The form is the one screen in this app somebody types a paragraph into. A refusal keeps the screen
/// open and the toast says so; the page closes only once the station has taken it. Starting a new show
/// over a running one asks first, because it is heard by everybody within a record.
/// `apps/android`'s `PlanScreen`.
struct PlanScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let currentBrief: String?
    let somethingOn: Bool

    @State private var scope: PlanScope = .keep
    @State private var form = PlanForm()
    @State private var seeded = false
    @State private var busy = false
    @State private var confirming = false
    @State private var personas: LoadState<[Persona]> = .loading

    var body: some View {
        let ui = PlanUiState(scope: scope, form: form, currentBrief: currentBrief, somethingOn: somethingOn)

        Form {
            if ui.showsScope {
                Section {
                    // The explicit-closure setter, not the method passed straight in: see apps/ios/CLAUDE.md.
                    Picker(String(localized: "Plan"), selection: Binding(get: { scope }, set: { scope = $0 })) {
                        Text(String(localized: "Keep this show")).tag(PlanScope.keep)
                        Text(String(localized: "Start a new show")).tag(PlanScope.new)
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(ui.keeping
                        ? String(localized: "Everything still to come is dropped and the station programmes that stretch again. What is playing, and what the player is already holding, keeps going.")
                        : String(localized: "The station programmes itself against this, from your own library first and from your providers when the library cannot fill it. A record it does not own yet is fetched and kept. What you like and dislike is taken into account either way."))
                }
            }

            if ui.warnsReplacing {
                Section {
                    Label(String(localized: "This starts a new broadcast: everything still to come is dropped, and what is playing stops."), systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }

            Section {
                TextField(String(localized: "warm and unhurried"), text: Binding(get: { form.brief }, set: { form.brief = String($0.prefix(PlanUiState.briefMax)) }), axis: .vertical)
                    .lineLimit(3...8)
                Text("\(form.brief.count)/\(PlanUiState.briefMax)").font(.caption2).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
            } header: {
                Text(String(localized: "Asked to play"))
            } footer: {
                Text(ui.keeping
                    ? String(localized: "This steers every refill for the rest of the broadcast, not just these records. Empty it to hand the programming back to the host.")
                    : String(localized: "In your own words, for the model that chooses records. It keeps steering every refill until the station is put on air again."))
            }

            if ui.keeping {
                Section {
                    Text(String(localized: "The host, the period and the shape belong to this show and keep running with it. Changing any of them starts a new one."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else {
                newShowFields(ui)
            }

            Section {
                Button {
                    if ui.warnsReplacing { confirming = true } else { submit(ui) }
                } label: {
                    if busy { ProgressView() } else { Text(ui.keeping ? String(localized: "Replan") : String(localized: "Go on air")).frame(maxWidth: .infinity) }
                }
                .disabled(!ui.canSubmit || busy)
            } footer: {
                Text(ui.keeping
                    ? String(localized: "The records are chosen before the old ones are dropped, so nothing goes quiet. They can take a minute to appear.")
                    : String(localized: "Choosing records against your words needs a model configured to programme with. Without one the station plays its own rotation, which is the designed answer rather than a failure."))
            }
        }
        .navigationTitle(String(localized: "Plan"))
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(String(localized: "Start a new show?"), isPresented: $confirming, titleVisibility: .visible) {
            Button(String(localized: "Go on air"), role: .destructive) { submit(ui) }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text(String(localized: "This starts a new broadcast: everything still to come is dropped, and what is playing stops."))
        }
        .onAppear {
            // Seeded from the broadcast for Keep, because clearing it is then an obvious gesture and
            // the operator can see what is steering the refills. Off air there is no show to keep.
            guard !seeded else { return }
            seeded = true
            scope = somethingOn ? .keep : .new
            form.brief = currentBrief ?? ""
        }
        .task {
            if let read = await model.read({ try await $0.personas.listPersonas().personas }) { personas = read }
        }
    }

    @ViewBuilder
    private func newShowFields(_ ui: PlanUiState) -> some View {
        Section(String(localized: "Hosted by")) {
            Picker(String(localized: "Hosted by"), selection: Binding(get: { form.personaId }, set: { form.personaId = $0 })) {
                Text(String(localized: "Whichever persona the station has on air")).tag(String?.none)
                ForEach(hostChoices(personas.value ?? [], currentId: nil), id: \.id) { choice in
                    Text(choice.name).tag(String?.some(choice.id))
                }
            }
            .pickerStyle(.navigationLink)
        }

        Section {
            yearField(String(localized: "From year"), text: Binding(get: { form.eraFrom }, set: { form.eraFrom = $0 }), error: ui.eraFromError)
            yearField(String(localized: "To year"), text: Binding(get: { form.eraTo }, set: { form.eraTo = $0 }), error: ui.eraToError)
        } header: {
            Text(String(localized: "Period"))
        } footer: {
            Text(String(localized: "A record whose release year the catalogue does not know is played whatever the period. Leaving it out is not evidence of the wrong decade, and demanding one would empty the draw on a library nothing has enriched."))
        }

        Section {
            Picker(String(localized: "Mode"), selection: Binding(get: { form.mode }, set: { form.mode = $0 })) {
                Text(String(localized: "Rotation")).tag(StationMode.rotation)
                Text(String(localized: "Setlist")).tag(StationMode.setlist)
                Text(String(localized: "Feature")).tag(StationMode.feature)
            }
            Picker(String(localized: "When it runs out"), selection: Binding(get: { form.onEnd }, set: { form.onEnd = $0 })) {
                Text(String(localized: "Keep going")).tag(StationOnEnd.extend)
                Text(String(localized: "Start again")).tag(StationOnEnd.repeat)
                Text(String(localized: "Stop")).tag(StationOnEnd.stop)
            }
        } footer: {
            Text(String(localized: "Starting again replays what this broadcast already aired. It never reaches further than that: a record you disliked stays off the air whether the broadcast is running for the first time or the fifth."))
        }

        Section {
            Toggle(String(localized: "Take calls during this broadcast"), isOn: Binding(get: { form.callins }, set: { form.callins = $0 }))
        } footer: {
            Text(String(localized: "A phone-in is written and spoken a turn at a time, so it lands minutes after it is asked for. A setlist or a feature takes none whatever this says."))
        }
    }

    private func yearField(_ label: String, text: Binding<String>, error: Message?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            TextField(label, text: text).keyboardType(.numberPad)
            if let error { Text(error.words).font(.caption).foregroundStyle(.red) }
        }
    }

    /// One submit at a time, and the page closes once the station has taken it.
    private func submit(_ ui: PlanUiState) {
        guard !busy, ui.canSubmit else { return }
        busy = true
        Task {
            let done = ui.keeping ? await model.orderActions.replan(ui.replanInput()) : await model.airActions.goOnAir(ui.putOnAirInput())
            busy = false
            if done { dismiss() }
        }
    }
}
