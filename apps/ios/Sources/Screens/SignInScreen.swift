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
                if let address = account.resetSentTo {
                    resetSent(address)
                } else if let challenge = account.challenge {
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

            // Asks for nothing but the address above: the password is what it is instead of.
            Button(String(localized: "Forgot your password?"), action: askForReset)
                .frame(maxWidth: .infinity)
        }
        .disabled(account.busy)
        // Focused on arrival: the page exists to be typed into.
        .onAppear { focus = .email }
    }

    /// The same box for both kinds of code. What differs is the sentence above it, its label, and
    /// the one extra button each has: an emailed code can be sent again, and an authenticator step
    /// can turn into an emailed one when the account has both.
    private func codeStep(_ challenge: SecondFactor) -> some View {
        let emailed = challenge.emailed
        return Group {
            Text(String(localized: "One more step")).font(.title2)
            Text(codeDetail(emailed)).foregroundStyle(.secondary)
            PillField {
                TextField(
                    emailed == nil ? String(localized: "Authenticator code") : String(localized: "Emailed code"),
                    text: Binding(get: { account.code }, set: { account = account.typingCode($0) })
                )
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focus, equals: .code)
            }
            if let error = account.error {
                Text(error.words).font(.footnote).foregroundStyle(.red).padding(.horizontal, 16)
            }
            submitButton(String(localized: "Sign in"))
            if emailed != nil {
                Button(String(localized: "Send it again")) { send(account.sendingAgain()) }
                    .frame(maxWidth: .infinity)
                    .disabled(account.busy)
            } else if case .authenticator(_, _, .some) = challenge {
                Button(String(localized: "Email me a code instead")) { send(account.usingEmail()) }
                    .frame(maxWidth: .infinity)
                    .disabled(account.busy)
            }
            Button(String(localized: "Start again")) { account = account.startingAgain() }
                .frame(maxWidth: .infinity)
                .disabled(account.busy)
        }
        .onAppear { focus = .code }
    }

    /// "We sent a code to r•••@example.com.", in the station's label for the address when it gave one.
    private func codeDetail(_ emailed: EmailCode?) -> String {
        guard let emailed else { return String(localized: "Enter the code from your authenticator app.") }
        if emailed.emailChallengeId == nil { return String(localized: "Sending a code to your email.") }
        if let sentTo = emailed.sentTo { return String(localized: "We sent a code to \(sentTo).") }
        return String(localized: "We sent a code to your email.")
    }

    /// After "Forgot your password?": where the link went, and the way back to the form. The link
    /// opens the station's web console rather than this app, so the words say what happens after it.
    private func resetSent(_ address: String) -> some View {
        Group {
            Text(String(localized: "Check your inbox")).font(.title2)
            Text(String(localized: "If \(address) has an account on this station, a link to choose a new password is on its way. It opens the station in your browser. Then come back and sign in here with the new password."))
                .foregroundStyle(.secondary)
            Button {
                account = account.startingAgain()
            } label: {
                Text(String(localized: "Back to sign in")).frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
        }
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

    /// "Forgot your password?": a reset link to the address typed, from the STORED station, for the
    /// reason `submit` uses it.
    private func askForReset() {
        guard let station = model.settings.settings.station else { return }
        account = account.askingReset()
        guard account.busy else { return }
        let email = account.email.trimmingCharacters(in: .whitespaces)
        Task {
            account = account.afterReset(await model.session.askForReset(station, email: email))
        }
    }

    private func submit() {
        guard let station = model.settings.settings.station, account.canSubmit else { return }
        account.busy = true
        let current = account
        Task {
            let result: SignInResult
            switch current.challenge {
            case nil:
                result = await model.session.signIn(station, email: current.email, password: current.password)
            case .authenticator(let challengeId, let methodId, _):
                result = await model.session.completeSecondFactor(station, email: current.email, challengeId: challengeId, methodId: methodId, code: current.code)
            case .email(let emailed):
                guard let emailChallengeId = emailed.emailChallengeId else { return }
                result = await model.session.completeEmailCode(
                    station, email: current.email, challengeId: emailed.challengeId, emailChallengeId: emailChallengeId, code: current.code
                )
            }
            account = account.after(result)
            await sendCodeIfNeeded()
        }
    }

    /// "Email me a code instead" and "Send it again": the state says a send is due, and this sends it.
    private func send(_ next: AccountState) {
        account = next
        Task { await sendCodeIfNeeded() }
    }

    /// Ask the station to email the code the page is waiting on, if it is waiting on one.
    ///
    /// Driven by the state rather than by whoever called, so the three ways into it (a challenge that
    /// leads with email, choosing email, sending again) cannot disagree about when a send is due.
    private func sendCodeIfNeeded() async {
        guard account.needsCodeSent, let station = model.settings.settings.station, let emailed = account.challenge?.emailed else { return }
        let result = await model.session.sendEmailCode(station, challengeId: emailed.challengeId)
        // The challenge may have been abandoned while the send was in flight.
        guard account.challenge?.challengeId == emailed.challengeId else { return }
        account = account.afterCodeSent(result)
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
