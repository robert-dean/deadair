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
                if let entry { AddressField(entry: entry) }
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
                Toggle("Play when the app opens", isOn: Binding(get: { model.settings.settings.playOnOpen }, set: { model.settings.setPlayOnOpen($0) }))
                // Here rather than on Now playing, as on Android, and only while the station is
                // playing: there is nothing to put to sleep otherwise.
                if model.listening.wantsToPlay {
                    let reading = model.nowPlaying.state.latest
                    SleepMenu(canWaitForRecord: reading.flatMap { Playhead.project($0.value.track, readAt: $0.readAt, now: .now) } != nil)
                }
            } header: {
                Text("Listening")
            } footer: {
                Text("Starts the station as the app opens, unless it is already playing. The station comes on air when you tune in, so the first seconds are quiet.")
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
            Picker("Format", selection: Binding(get: { model.settings.settings.format }, set: { model.settings.choose($0) })) {
                ForEach(StreamFormat.allCases, id: \.self) { format in
                    Text(format.label)
                        .foregroundStyle(available[format] == false ? .secondary : .primary)
                        .tag(format)
                }
            }
            .pickerStyle(.inline)
            .labelsHidden()
            // Said here, beside the choice it is about, and only while something is playing.
            if let note = model.nowPlayingUi.fallbackNote {
                Text(note.words).font(.footnote).foregroundStyle(.orange)
            }
        } header: {
            Text("Format")
        } footer: {
            Text("MP3 always plays. HLS is the one for a phone that moves between wifi and mobile data. A format your station does not publish plays as MP3, and this page says so.")
        }
        .task { await model.nowPlaying.hold() }
    }
}

/// Signing in as the station's operator. Optional, and says so.
struct AccountSection: View {
    @Environment(AppModel.self) private var model
    @State private var account = AccountState()

    var body: some View {
        Section {
            switch model.session.state {
            case .signedIn(let email, let roles):
                LabeledContent("Signed in as", value: email)
                Text(roles.contains(.admin) ? "The station says this account operates it." : "The station says this account only listens.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Sign out", role: .destructive) {
                    Task { await model.session.signOut() }
                }
            case .signedOut:
                if let challenge = account.challenge {
                    codeStep(challenge)
                } else {
                    passwordStep
                }
                if let error = account.error {
                    Text(error.words).font(.footnote).foregroundStyle(.red)
                }
            }
        } header: {
            Text("Account")
        } footer: {
            Text("Listening needs no account. Signing in with the operator's email and password lets this app read more of what the station says about itself.")
        }
    }

    private var passwordStep: some View {
        Group {
            TextField("Email", text: Binding(get: { account.email }, set: { account = account.typingEmail($0) }))
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textContentType(.username)
            SecureField("Password", text: Binding(get: { account.password }, set: { account = account.typingPassword($0) }))
                .textContentType(.password)
            Button {
                submit()
            } label: {
                if account.busy { ProgressView() } else { Text("Sign in") }
            }
            .disabled(!account.canSubmit)
        }
    }

    private func codeStep(_ challenge: SecondFactor) -> some View {
        Group {
            Text("Enter the code from the authenticator app for \(account.email).")
                .font(.footnote)
            TextField("Code", text: Binding(get: { account.code }, set: { account = account.typingCode($0) }))
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
            Button {
                submit()
            } label: {
                if account.busy { ProgressView() } else { Text("Verify") }
            }
            .disabled(!account.canSubmit)
            Button("Start again") { account = account.startingAgain() }
        }
    }

    private func submit() {
        guard let station = model.settings.settings.station, account.canSubmit else { return }
        account.busy = true
        let current = account
        Task {
            let result: SignInResult
            if let challenge = current.challenge {
                result = await model.session.completeSecondFactor(
                    station, email: current.email, challengeId: challenge.challengeId, methodId: challenge.methodId, code: current.code
                )
            } else {
                result = await model.session.signIn(station, email: current.email, password: current.password)
            }
            account = account.after(result)
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
                Label {
                    Text(timer.line(at: .now)?.words ?? String(localized: "Sleep timer"))
                } icon: {
                    Image(systemName: timer.state == .off ? "moon.zzz" : "moon.zzz.fill")
                }
            }
        }
        .accessibilityLabel(Text("Sleep timer"))
    }
}
