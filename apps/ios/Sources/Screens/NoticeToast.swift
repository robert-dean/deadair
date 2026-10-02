import DeadairCore
import SwiftUI

extension View {
    /// What the app has to say, drawn above everything this view holds.
    func toasts() -> some View {
        overlay(alignment: .top) { NoticeToast() }
    }
}

/// One thing at a time, along the top, for a few seconds or until it is tapped: an operator's
/// refusal, or a break that could not be got ready to send.
///
/// Drawn at the root, above the navigation stack, rather than by each screen: `apps/android` lost
/// a refusal raised on a pushed screen because its collector lived on a screen that was not showing,
/// and the operator watched a button do nothing. Here there is one place it is drawn, and it is on
/// top of whatever the reader is looking at.
private struct NoticeToast: View {
    @Environment(AppModel.self) private var model

    /// Long enough to read a sentence, short enough not to sit over the screen.
    private static let shown: Duration = .seconds(4)

    var body: some View {
        let toasts = model.toasts
        ZStack {
            if let posted = toasts.current {
                Text(posted.message.words)
                    .font(.callout)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .shadow(radius: 6, y: 2)
                    .padding(.horizontal)
                    .onTapGesture { toasts.dismiss(posted.id) }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .accessibilityAddTraits(.isStaticText)
                    .task(id: posted.id) {
                        // VoiceOver reads it as it arrives, since it was not where the finger was.
                        AccessibilityNotification.Announcement(posted.message.words).post()
                        try? await Task.sleep(for: Self.shown)
                        withAnimation { toasts.dismiss(posted.id) }
                    }
            }
        }
        .animation(.default, value: toasts.current)
    }
}
