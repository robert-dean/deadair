import SwiftUI

/// A page that is nothing but the operator's, which says it is locked until it is not.
///
/// Over the page rather than popping the stack, so a page the lock shut while the app was away is
/// still there after the unlock. `apps/android`'s `OperatorGate`.
struct OperatorGate<Content: View>: View {
    @Environment(AppModel.self) private var model
    @ViewBuilder let content: () -> Content

    var body: some View {
        if model.operatorLocked {
            ContentUnavailableView {
                Label(String(localized: "The station's controls are locked"), systemImage: "lock.fill")
            } description: {
                Text(String(localized: "Unlock them to carry on here. Listening is not affected."))
            } actions: {
                Button(String(localized: "Unlock")) { Task { await model.unlockOperator() } }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            content()
        }
    }
}
