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
            }
            FormatSection()
            AccountSection()
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
        } header: {
            Text("Format")
        } footer: {
            Text("MP3 always plays. HLS is the one for a phone that moves between wifi and mobile data. A format your station does not publish plays as MP3, and the player says so.")
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
        .task(id: model.session.stored?.email) { await model.session.ensureRoles() }
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
