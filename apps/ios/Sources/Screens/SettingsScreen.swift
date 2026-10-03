import DeadairCore
import SwiftUI

/// The station, the format, and the account, in that order: the account is last because most
/// listeners will never need it.
struct SettingsScreen: View {
    @Environment(AppModel.self) private var model
    @State private var entry: StationEntry?

    var body: some View {
        Form {
            Section("Station") {
                if let entry { AddressField(entry: entry, changing: true) }
                // The desk is the operator's: a thing you go and do, so a page rather than a tab, and
                // here where somebody asks why nothing is going out.
                if model.isOperator {
                    NavigationLink(value: PageRoute.desk) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(String(localized: "The desk"))
                            Text(String(localized: "Take the station off air, hold it against the schedule, and see why it is or is not on."))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            FormatSection()
            Section {
                // The explicit-closure setter, not the method passed straight in: see apps/ios/CLAUDE.md.
                Toggle(isOn: Binding(get: { model.settings.settings.playOnOpen }, set: { model.settings.setPlayOnOpen($0) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Play when the app opens")
                        Text("Starts the station as the app opens, unless it is already playing. The first seconds are quiet while the station comes on air.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                // Here rather than on Now playing, as on Android, and only while the station is
                // playing: there is nothing to put to sleep otherwise.
                if model.listening.wantsToPlay {
                    let reading = model.nowPlaying.state.latest
                    SleepMenu(canWaitForRecord: reading.flatMap { Playhead.project($0.value.track, readAt: $0.readAt, now: .now) } != nil)
                }
            } header: {
                Text("Listening")
            }
            AccountSection()
            Section {
                Link(String(localized: "Privacy policy"), destination: privacyPolicyURL)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            if entry == nil { entry = StationEntry(stored: model.settings.settings.stationText) }
        }
    }
}

/// How to listen. What the station publishes comes from `/nowplaying`'s `mounts[]`, never from
/// connecting to each mount to see: a connection is an audience, and an audience-gated station
/// would be put on air for five minutes by somebody opening this screen.
struct FormatSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let available = availableFormats(model.nowPlaying.state.latest?.value.mounts)
        Section {
            // Automatic first, because it is what nobody choosing gets, and never greyed, because it
            // resolves to something every station publishes.
            FormatRow(label: StreamFormat.automaticLabel, purpose: StreamFormat.automaticPurpose, chosen: model.settings.settings.format == nil, published: true) {
                model.settings.choose(nil)
            }
            // A row per format, each saying what it is for, and one the station does not publish
            // greyed with the reason, Android's radio rows.
            ForEach(StreamFormat.allCases, id: \.self) { format in
                FormatRow(
                    label: format.label, purpose: format.purpose, chosen: model.settings.settings.format == format,
                    published: available[format] != false
                ) {
                    model.settings.choose(format)
                }
            }
            // Said here, beside the choice it is about, and only while something is playing.
            if let note = model.nowPlayingUi.fallbackNote {
                Text(note.words).font(.footnote).foregroundStyle(.orange)
            }
        } header: {
            Text("Format")
        }
        .task { await model.nowPlaying.hold() }
    }
}

/// One row of the format list: a radio, the name, and what it is for, or why it cannot be had.
private struct FormatRow: View {
    let label: String
    let purpose: String
    let chosen: Bool
    let published: Bool
    let choose: () -> Void

    var body: some View {
        Button(action: choose) {
            HStack(spacing: 12) {
                Image(systemName: chosen ? "largecircle.fill.circle" : "circle")
                    .font(.title3)
                    .foregroundStyle(chosen ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).foregroundStyle(published ? .primary : .secondary)
                    Text(published ? purpose : String(localized: "Not published by this station"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!published && !chosen)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// The account: one row that opens the sign-in page, or who is signed in and the way out. Optional,
/// and says so. `apps/android`'s `AccountSection`.
struct AccountSection: View {
    @Environment(AppModel.self) private var model
    @State private var confirmingSignOut = false

    var body: some View {
        Section {
            switch model.session.state {
            case .signedIn(let email, let roles):
                VStack(alignment: .leading, spacing: 2) {
                    Text(email)
                    Text(roles.contains(.admin) ? String(localized: "Signed in as the operator of this station") : String(localized: "Signed in to this station as a listener"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Button(String(localized: "Sign out"), role: .destructive) { confirmingSignOut = true }
                    .confirmationDialog(String(localized: "Sign out?"), isPresented: $confirmingSignOut, titleVisibility: .visible) {
                        Button(String(localized: "Sign out"), role: .destructive) { Task { await model.session.signOut() } }
                    } message: {
                        Text(String(localized: "What the station has played and what is on next go back behind the sign-in. Listening is not affected."))
                    }
            case .signedOut:
                NavigationLink(value: PageRoute.signIn) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "Sign in"))
                        Text(String(localized: "Optional. Listening needs no account. Signing in adds what the station has played and what is on next."))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("Account")
        }
    }
}

/// The sleep timer: a moon that opens the choices, and the countdown beside it while one is set.
///
/// "After this record" is offered only when the station can say how much of the record is left,
/// the rule the progress bar already keeps: a timer set against a guess would stop the station at
/// the wrong moment for somebody who is by then asleep.
struct SleepMenu: View {
    @Environment(AppModel.self) private var model
    let canWaitForRecord: Bool

    var body: some View {
        let timer = model.listening.sleepTimer
        Menu {
            ForEach(SleepTimer.choices, id: \.self) { minutes in
                Button(String(localized: "\(minutes) minutes")) { timer.arm(.minutes(minutes)) }
            }
            Button(String(localized: "After this record")) { timer.arm(.afterRecord) }
                .disabled(!canWaitForRecord)
            if timer.state != .off {
                Button(String(localized: "Turn off the timer"), role: .destructive) { timer.clear() }
            }
        } label: {
            // Ticks once a second, which only matters while a countdown is showing.
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(String(localized: "Sleep timer")).foregroundStyle(.primary)
                        Text(timer.line(at: .now)?.words ?? String(localized: "Stops listening on this phone after a while."))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: timer.state == .off ? "moon.zzz" : "moon.zzz.fill").foregroundStyle(.tint)
                }
            }
        }
        .accessibilityLabel(Text("Sleep timer"))
    }
}
