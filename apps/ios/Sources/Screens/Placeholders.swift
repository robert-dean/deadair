import DeadairCore
import SwiftUI

/// What a tab shows before anybody has signed in: the tab's name, the offer, and the way to take it.
///
/// An offer rather than a wall, and phrased as one. The station keeps this behind an account because
/// it is the console's own data, not because a listener is unwelcome. `apps/android`'s
/// `SignedOutPlaceholder`, heading, detail and button at its sizes.
struct SignedOutPlaceholder: View {
    @Environment(AppModel.self) private var model
    /// What this screen is called, as its heading.
    let what: String

    var body: some View {
        CentredColumn {
            Text(what).font(.title2).multilineTextAlignment(.center)
            Text(String(localized: "The station keeps this for signed-in listeners. Listening itself needs no account."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
            Button(String(localized: "Sign in")) { model.tab = .settings }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .padding(.top, 24)
        }
    }
}

/// A screen that could not reach the station and has nothing older to show instead.
///
/// Told apart from an empty answer by having something to press. Every poll backs off while the
/// station is not answering, up to five minutes, and a listener who has just fixed their wifi should
/// not have to wait that out looking at a sentence. `apps/android`'s `ErrorPlaceholder`.
struct ErrorPlaceholder: View {
    var what = String(localized: "Could not reach the station")
    var detail = String(localized: "Check that you are on the right network. The app keeps trying on its own, more slowly each time.")
    /// Absent where trying again cannot help, such as a record the station no longer has.
    var retry: (() -> Void)?

    var body: some View {
        CentredColumn {
            Text(what).font(.title2).multilineTextAlignment(.center)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 8)
            if let retry {
                Button(String(localized: "Try again"), action: retry)
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .padding(.top, 24)
            }
        }
    }
}

/// The same shape for a screen that has nothing to show yet, so an empty answer is not read as a fault.
struct EmptyPlaceholder: View {
    let what: String

    var body: some View {
        CentredColumn {
            Text(what).font(.body).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
    }
}

/// The placeholders' frame: centred on the whole screen, with the gutter either side.
private struct CentredColumn<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .padding(.horizontal, 32)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// What a screen says when its reading is no longer current, and when it was last true.
///
/// At full strength, above the content, rather than the content dimmed: dimming a whole list took the
/// quieter lines below anything readable, the sentence explaining the dimming with them. The pictures
/// fade a little to mark them as not current; the words stay readable. `apps/android`'s `StaleBanner`.
struct StaleBanner: View {
    /// When the reading being shown was taken. Without it the banner says only that it is the last.
    var readAt: ContinuousClock.Instant?

    var body: some View {
        let message: Message = readAt.map { .lastSaidAt(wallClock(of: $0)) } ?? .lastSaid
        Text(message.words)
            .font(.footnote)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
            .accessibilityAddTraits(.updatesFrequently)
            .onAppear { AccessibilityNotification.Announcement(message.words).post() }
    }

    /// The time of day a continuous-clock instant was, by the phone's clock now.
    private func wallClock(of instant: ContinuousClock.Instant) -> Clock {
        let ago = ContinuousClock.now - instant
        let seconds = Double(ago.components.seconds) + Double(ago.components.attoseconds) / 1e18
        let parts = Calendar.current.dateComponents([.hour, .minute], from: Date.now.addingTimeInterval(-seconds))
        return Clock(hour: parts.hour ?? 0, minute: parts.minute ?? 0)
    }
}

extension View {
    /// The stale banner pinned above a list rather than scrolled away inside it.
    func staleBanner(_ stale: Bool, readAt: ContinuousClock.Instant? = nil) -> some View {
        safeAreaInset(edge: .top, spacing: 0) {
            if stale {
                StaleBanner(readAt: readAt)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color(uiColor: .systemBackground).opacity(0.001))
            }
        }
    }
}
