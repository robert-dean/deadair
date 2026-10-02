import DeadairCore
import DeadairSdk
import SwiftUI

/// What the station thinks of one record, artist or album: never play it, no opinion, play it more.
///
/// One question with three answers, so one segmented row rather than two toggles, and the middle is a
/// segment of its own because withdrawing an opinion is a choice an operator should be able to see.
/// Not a star scale: like and dislike are opposite poles, not one and two stars. Each segment is
/// NAMED for what it rates ("Play Paranoid more often"), so a list of these is a list of
/// distinguishable controls to VoiceOver. `apps/android`'s `RatingControl`.
struct RatingSection: View {
    let rating: Rating
    /// What is being rated, for the segments' names.
    let label: String
    let busy: Bool
    let onRate: (Rating) -> Void

    var body: some View {
        Section {
            HStack(spacing: 0) {
                segment(.disliked, symbol: "hand.thumbsdown", name: String(localized: "Never play \(label)"))
                Divider().frame(height: 28)
                segment(.neutral, symbol: "minus", name: String(localized: "No opinion about \(label)"))
                Divider().frame(height: 28)
                segment(.liked, symbol: "hand.thumbsup", name: String(localized: "Play \(label) more often"))
            }
            .disabled(busy)
        } footer: {
            Text(String(localized: "This is the station's mark, not a favourite: it changes how often the station plays this."))
        }
    }

    private func segment(_ value: Rating, symbol: String, name: String) -> some View {
        let selected = ratingSelection(rating) == value
        return Button {
            onRate(value)
        } label: {
            Image(systemName: selected ? "\(symbol).fill" : symbol)
                .font(.title3)
                .frame(maxWidth: .infinity, minHeight: 36)
                .foregroundStyle(selected ? Color.accentColor : .secondary)
                .contentShape(Rectangle())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(Text(name))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The operator's rating on a detail page: one write at a time, and the page read again after a write
/// that landed, so the control shows the mark the station now holds rather than the one pressed.
@MainActor
@Observable
final class RatingWrites {
    private(set) var busy = false

    func rate(_ write: @escaping @MainActor () async -> Bool, then reload: @escaping @MainActor () -> Void) {
        guard !busy else { return }
        busy = true
        Task {
            if await write() { reload() }
            busy = false
        }
    }
}
