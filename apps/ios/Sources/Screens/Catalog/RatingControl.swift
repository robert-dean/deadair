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
        VStack(alignment: .leading, spacing: 0) {
            SegmentedChoice(
                segments: [
                    .init(value: Rating.disliked, symbol: "hand.thumbsdown", name: String(localized: "Never play \(label)")),
                    .init(value: .neutral, symbol: "minus.circle", name: String(localized: "No opinion about \(label)")),
                    .init(value: .liked, symbol: "hand.thumbsup", name: String(localized: "Play \(label) more often")),
                ],
                selected: ratingSelection(rating),
                iconSize: 20,
                onPick: onRate
            )
            .disabled(busy)
            Text(String(localized: "This is the station's mark, not a favourite: it changes how often the station plays this."))
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 8)
        }
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
