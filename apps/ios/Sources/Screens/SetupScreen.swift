import SwiftUI

/// Where the privacy policy is published: `apps/ios/PRIVACY.md`, the same address the App Store
/// listing names in `appstore/metadata/en-US/privacy_url.txt`. The path is a promise to every install
/// that has it, so it does not move.
let privacyPolicyURL = URL(string: "https://github.com/robert-dean/deadair/blob/main/apps/ios/PRIVACY.md")!

/// The first screen: a welcome, then where is the station?
///
/// Two steps, as on Android. A welcome first, because the address field is a strange first thing to
/// meet in an app somebody has just installed to listen to the radio; then the field. Nothing is
/// prefilled by the app itself: there is no address that is right for more than one person, and a
/// wrong one that looks deliberate is worse than an empty field.
struct SetupScreen: View {
    @State private var entry = StationEntry(stored: nil)
    @State private var path: [SetupStep] = []

    var body: some View {
        NavigationStack(path: $path) {
            Welcome { path = [.station] }
                .navigationDestination(for: SetupStep.self) { _ in
                    Form {
                        Section {
                            AddressField(entry: entry, offersSignIn: true)
                        } header: {
                            Text("Your station")
                        } footer: {
                            Text("The address your station's console loads from. One address carries the console, the API and the stream, so it is all this app needs. Listening needs no account.")
                        }
                    }
                    .navigationTitle(String(localized: "Find your station"))
                    .navigationBarTitleDisplayMode(.inline)
                }
        }
    }
}

/// Which step of setup is pushed over the welcome.
enum SetupStep: Hashable {
    case station
}

/// The mark, the name, and the one thing to do next, with the privacy policy beneath it: before any
/// station, because this is the one screen a person without one can reach, and App Review needs the
/// policy reachable from inside the app.
private struct Welcome: View {
    let start: () -> Void
    @State private var revealed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Image("StationMark")
                .resizable()
                .scaledToFit()
                .frame(width: 168, height: 168)
                .clipShape(RoundedRectangle(cornerRadius: 38, style: .continuous))
                .accessibilityHidden(true)
            Text("deadair")
                .font(.largeTitle.weight(.semibold))
                .padding(.top, 28)
                .opacity(revealed ? 1 : 0)
                .offset(y: revealed ? 0 : 24)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            VStack(spacing: 8) {
                Button(action: start) {
                    Text(String(localized: "Find your station")).frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                Link(String(localized: "Privacy policy"), destination: privacyPolicyURL)
                    .font(.footnote)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
            .opacity(revealed ? 1 : 0)
            .offset(y: revealed ? 0 : 24)
        }
        .frame(maxWidth: 520)
        // The name and then the button rise into place around the mark, once per arrival. With Reduce
        // Motion on they are simply there.
        .onAppear {
            if reduceMotion { revealed = true } else { withAnimation(.easeOut(duration: 0.5).delay(0.15)) { revealed = true } }
        }
    }
}
