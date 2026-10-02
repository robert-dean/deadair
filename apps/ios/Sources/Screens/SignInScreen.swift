import DeadairCore
import SwiftUI

/// Signing in as the station's operator, on a page of its own: `apps/android`'s `SignInScreen`.
///
/// A page rather than fields inside Settings, so every "Sign in" in the app (Settings, a signed-out
/// tab, setup) opens the same thing, and it closes itself once the station has said yes, leaving the
/// reader where they asked from with that screen now loaded. The code box is a separate step because
/// it is a separate exchange with the station.
struct SignInScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var account = AccountState()
    @State private var passwordShown = false
    @FocusState private var focus: Field?

    private enum Field { case email, password, code }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let challenge = account.challenge {
                    codeStep(challenge)
                } else {
                    passwordStep
                }
            }
            .padding(16)
            .frame(maxWidth: 480, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationBarTitleDisplayMode(.inline)
        // Closed by the station's yes, not by the button: a refusal has to be said on this page.
        .onChange(of: model.signedIn) { _, signedIn in
            if signedIn { dismiss() }
        }
    }

    private var passwordStep: some View {
        Group {
            Text(String(localized: "Sign in to \(model.settings.settings.stationName ?? "deadair")"))
                .font(.title.weight(.regular))
            Text(String(localized: "Listening needs no account. Signing in adds what the station has played and what is on next, and the station's controls if you run it."))
                .foregroundStyle(.secondary)

            PillField {
                TextField(String(localized: "Email"), text: Binding(get: { account.email }, set: { account = account.typingEmail($0) }))
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    .submitLabel(.next)
                    .focused($focus, equals: .email)
                    .onSubmit { focus = .password }
            }
            .padding(.top, 8)

            // Shown on request: a mistyped long password on a phone keyboard is a certain retry, and
            // this page clears the password on a refusal, so without a way to look it is retyped blind.
            PillField {
                HStack {
                    Group {
                        if passwordShown {
                            TextField(String(localized: "Password"), text: password)
                        } else {
                            SecureField(String(localized: "Password"), text: password)
                        }
                    }
                    .textContentType(.password)
                    .submitLabel(.go)
                    .focused($focus, equals: .password)
                    .onSubmit(submit)
                    Button {
                        passwordShown.toggle()
                    } label: {
                        Image(systemName: passwordShown ? "eye.slash" : "eye").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(passwordShown ? Text("Hide password") : Text("Show password"))
                }
            }
            // Under the password, the field that is retyped and the one this page clears.
            if let error = account.error {
                Text(error.words).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16)
            }

            submitButton(String(localized: "Sign in"))
        }
        .disabled(account.busy)
        // Focused on arrival: the page exists to be typed into.
        .onAppear { focus = .email }
    }

    private func codeStep(_ challenge: SecondFactor) -> some View {
        Group {
            Text(String(localized: "One more step")).font(.title2)
            Text(String(localized: "Enter the code from your authenticator app.")).foregroundStyle(.secondary)
            PillField {
                TextField(String(localized: "Authenticator code"), text: Binding(get: { account.code }, set: { account = account.typingCode($0) }))
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .focused($focus, equals: .code)
            }
            if let error = account.error {
                Text(error.words).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16)
            }
            submitButton(String(localized: "Sign in"))
            Button(String(localized: "Start again")) { account = account.startingAgain() }
                .frame(maxWidth: .infinity)
        }
        .onAppear { focus = .code }
    }

    private var password: Binding<String> {
        Binding(get: { account.password }, set: { account = account.typingPassword($0) })
    }

    /// The button keeps its place while the station answers, with the spinner inside it.
    private func submitButton(_ title: String) -> some View {
        Button(action: submit) {
            ZStack {
                Text(title).opacity(account.busy ? 0 : 1)
                if account.busy { ProgressView() }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .disabled(!account.canSubmit)
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

/// Android's pill text field: a filled capsule the height of a button, the text inset in it.
struct PillField<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.horizontal, 20)
            .frame(minHeight: 52)
            .background(Color(uiColor: .secondarySystemBackground), in: Capsule())
    }
}
