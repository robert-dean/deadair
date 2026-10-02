import DeadairCore
import DeadairSdk
import SwiftUI
import UIKit

/// The desk: everything that can take the station off air, and why it is or is not on.
///
/// A pushed page rather than a tab, reached from Settings: it is a thing you go and do. Now playing
/// keeps Skip, which ends one record and is a listener-scale decision; Take off air, the hold, the air
/// mode and the diagnosis live only here, so the two stops are on different screens and neither can be
/// mistaken for the other. Top to bottom: the verdict, the pair, the record they act on, the hold, the
/// air mode, and the panel that says why, open on its own the moment there is a fault.
/// `apps/android`'s `DeskScreen`.
struct DeskScreen: View {
    @Environment(AppModel.self) private var model
    /// One operator command at a time, shared by every control on the page.
    @State private var busy = false

    var body: some View {
        Group {
            switch model.playout.state(signedIn: model.signedIn) {
            case .signedOut:
                SignedOutPlaceholder(what: String(localized: "The desk"))
            case .loading:
                ProgressView()
            case .unreachable:
                ErrorPlaceholder(retry: { model.playout.retry() })
            case .loaded(let status, let air, let stale):
                desk(DeskUiState(transport: TransportUiState(status: status, air: air, busy: busy)), stale: stale)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle(String(localized: "The desk"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { model.playout.retry() }
        .task { await model.playout.hold() }
    }

    private func desk(_ ui: DeskUiState, stale: Bool) -> some View {
        let transport = ui.transport
        return List {
            if stale { StaleBanner() }

            Section {
                HStack(spacing: 12) {
                    Lamp(tone: ui.silence.tone, size: 12)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ui.heading.words).font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                        Text(ui.line.words).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                TransportPair(transport: transport, act: act)
                if let record = ui.record {
                    RecordLine(record: record, listeners: .listeners(count: transport.status.listeners, format: model.settings.settings.format))
                }
            }

            if let driving = transport.driving {
                Section {
                    Text(driving.words).font(.footnote).foregroundStyle(.secondary)
                }
            }

            if let hold = transport.hold() {
                Section(String(localized: "Hold")) {
                    HoldLine(hold: hold, busy: transport.busy, act: act)
                }
            }

            if let mode = transport.airMode {
                Section(String(localized: "On air")) {
                    // The explicit-closure setter, not the method passed straight in: see apps/ios/CLAUDE.md.
                    Picker(String(localized: "On air"), selection: Binding(get: { mode }, set: { next in
                        if next != mode { act { await model.transport.setAirMode(next) } }
                    })) {
                        Text(String(localized: "When someone listens")).tag(AirMode.audience)
                        Text(String(localized: "Always")).tag(AirMode.always)
                    }
                    .pickerStyle(.segmented)
                    .disabled(transport.busy)
                }
            }

            SilencePanel(reading: ui.silence)
        }
    }

    /// Take the one turn there is, and give it back when the station has answered.
    private func act(_ action: @escaping @MainActor () async -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            await action()
            busy = false
        }
    }
}

/// Skip and Take off air side by side at equal widths, so the armed label cannot clip and Skip does
/// not move between the press that arms and the press that fires: the one moment on the screen when
/// nothing may move. Start takes the second place while the station is stood down.
///
/// Named by what it stops: the round button on Now playing stops this phone, and both were "Stop",
/// to a thumb and to VoiceOver. Armed, it fills and drains a bar along its foot, so the five seconds
/// it waits are seen rather than guessed at; when the bar empties it is Take off air again.
private struct TransportPair: View {
    @Environment(AppModel.self) private var model
    let transport: TransportUiState
    let act: (@escaping @MainActor () async -> Void) -> Void
    @State private var stop = ArmedStop()

    var body: some View {
        HStack(spacing: 12) {
            // The width goes on the label, inside the button: on the button itself it widens the row
            // and leaves the button the size of its word.
            Button { act { await model.transport.skip() } } label: {
                Text(String(localized: "Skip")).frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(!transport.skipEnabled)
            if transport.showsStart {
                Button { act { await model.transport.start() } } label: {
                    Text(String(localized: "Start")).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(transport.busy)
            } else {
                // Ticks only while armed, to drain the bar; the task below forgets the arm when the
                // five seconds are up, so a lapsed arm needs two presses again.
                TimelineView(.animation(minimumInterval: 0.05, paused: stop.armedAt == nil)) { _ in
                    let armed = stop.isArmed(at: .now)
                    Button {
                        if stop.press(at: .now) { act { await model.transport.stop() } }
                    } label: {
                        // Two lines rather than cut short: the armed label is the one sentence on the
                        // screen that has to be read whole.
                        Text(armed ? String(localized: "Press again to go off air") : String(localized: "Take off air"))
                            .font(armed ? .subheadline.weight(.semibold) : .body)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                    .overlay(alignment: .bottom) {
                        if armed, let armedAt = stop.armedAt {
                            let left = 1 - (ContinuousClock.now - armedAt) / ArmedStop.window
                            GeometryReader { geometry in
                                Rectangle().fill(.red).frame(width: geometry.size.width * max(left, 0), height: 3)
                            }
                            .frame(height: 3)
                        }
                    }
                    .disabled(transport.busy)
                }
                .task(id: stop.armedAt) {
                    guard stop.armedAt != nil else { return }
                    try? await Task.sleep(for: ArmedStop.window)
                    stop.disarm()
                }
            }
        }
        .buttonBorderShape(.roundedRectangle)
        .controlSize(.large)
    }
}

/// The record the pair acts on, and how many are listening.
private struct RecordLine: View {
    @Environment(AppModel.self) private var model
    let record: DeskRecord
    let listeners: Message

    var body: some View {
        HStack(spacing: 14) {
            ArtworkView(url: model.settings.settings.station?.artUrl(record.artworkUrl).flatMap(URL.init(string:)), loader: model.artwork, cornerRadius: 8, placeholderSize: 20)
                .frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 2) {
                Text(record.title).font(.body.weight(.semibold)).lineLimit(1)
                Text(record.line.words).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text(listeners.words).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The state and the way out of it are the same control: a hold that cannot be SEEN is worse than no
/// hold. Each button says what it does to the sentence above it rather than naming the mechanism.
private struct HoldLine: View {
    @Environment(AppModel.self) private var model
    let hold: HoldUi
    let busy: Bool
    let act: (@escaping @MainActor () async -> Void) -> Void

    /// The console's second hold: long enough for a show, short enough that a forgotten one lapses tonight.
    private static let twoHours = 120

    var body: some View {
        let line: Message =
            switch hold {
            case .offered: .scheduleTakesThisBack
            case .heldUntilReleased: .heldUntilReleased
            case .heldUntil(let clock): .heldUntilAbout(clock)
            }
        Text(line.words)
        if case .offered = hold {
            Button(String(localized: "Keep it on past the next block")) { act { await model.transport.hold(minutes: nil) } }.disabled(busy)
            Button(String(localized: "Keep it on for two hours")) { act { await model.transport.hold(minutes: Self.twoHours) } }.disabled(busy)
        } else {
            Button(String(localized: "Release")) { act { await model.transport.release() } }.disabled(busy)
        }
    }
}

/// Why the station is or is not on air, one tap deep.
///
/// The console's diagnosis panel with the same split: a lamp and two words always, and the reason, the
/// remedy and everything the station ruled out behind a tap. Shut while the station is live or merely
/// waiting; open on its own the moment there is a fault, because that is when the lines are worth
/// reading. Nothing here decides anything. Every sentence comes from the station.
private struct SilencePanel: View {
    let reading: SilenceReading
    @State private var open = false

    var body: some View {
        Section {
            Button {
                withAnimation { open.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Lamp(tone: reading.tone)
                    Text(reading.label.words).font(.headline).foregroundStyle(.primary)
                    Spacer()
                    Image(systemName: open ? "chevron.up" : "chevron.down").foregroundStyle(.secondary)
                }
            }
            .accessibilityHint(open ? Text("Hide why") : Text("Show why"))

            if open {
                if !reading.live { Text(reading.title.words).font(.headline) }
                Text(reading.detail).font(.callout)
                if let remedy = reading.remedy { RemedyLine(remedy: remedy) }
                ForEach(Array(reading.otherFaults.enumerated()), id: \.offset) { _, fault in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Message.silenceTitle(fault.code).words).font(.subheadline.weight(.semibold))
                        Text(fault.detail).font(.footnote)
                        if let remedy = fault.remedy { RemedyLine(remedy: Remedy(text: remedy)) }
                    }
                    .listRowBackground(Color.red.opacity(0.12))
                }
                if !reading.ruledOut.isEmpty {
                    // What the station checked and was happy with: somebody chasing silence is deciding
                    // where to look next, and a list of places they do not have to look is most of that.
                    VStack(alignment: .leading, spacing: 4) {
                        Text(String(localized: "Ruled out (\(reading.ruledOut.count))")).font(.caption).foregroundStyle(.secondary)
                        ForEach(Array(reading.ruledOut.enumerated()), id: \.offset) { _, check in
                            Text("✓ \(check.detail)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .task(id: reading.tone) {
            if reading.tone == .fault { open = true }
        }
    }
}

/// What would clear it. A shell command is set in monospace with a Copy button and nothing else: the
/// app cannot restart a sibling container, and a button that pretended otherwise would be a lie about
/// what a phone can do.
private struct RemedyLine: View {
    let remedy: Remedy
    @State private var copied = false

    var body: some View {
        if remedy.isCommand {
            HStack {
                Text(remedy.text).font(.footnote.monospaced()).textSelection(.enabled)
                Spacer()
                Button(copied ? String(localized: "Copied") : String(localized: "Copy")) {
                    UIPasteboard.general.string = remedy.text
                    copied = true
                }
                .buttonStyle(.borderless)
            }
        } else {
            Text(remedy.text).font(.footnote).foregroundStyle(.secondary)
        }
    }
}

/// The station's verdict as a colour, shared by the heading and the panel so the two can never disagree.
struct Lamp: View {
    let tone: SilenceTone
    var size: CGFloat = 10

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    private var color: Color {
        switch tone {
        case .live: .accentColor
        case .standby: .orange
        case .off: .gray
        case .fault: .red
        }
    }
}
