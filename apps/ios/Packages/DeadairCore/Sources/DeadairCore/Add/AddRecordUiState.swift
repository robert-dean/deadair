import DeadairSdk
import Foundation

/// The library search's rules, which are the station's rules restated. `apps/android`'s `AddRecordUiState`.
public enum LibrarySearch {
    /// The fewest letters worth asking the station about, and how long the box must be still first:
    /// the console's own numbers, so a phone and a desk put the same load on a station that
    /// rate-limits. Typing a title is one request rather than one per letter, and one letter matches
    /// half the library.
    public static let minChars = 2
    public static let debounce: Duration = .milliseconds(250)

    /// What the box means as a query: trimmed, or `nil` for nothing worth sending. `nil` rather than an
    /// empty string because the station refuses an empty `search` outright, which is a 400 for a box
    /// the operator has just cleared.
    public static func term(_ typed: String) -> String? {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count >= minChars ? trimmed : nil
    }
}

/// Where Play next puts a record: in front of the first item nobody has handed to the player, which is
/// the lowest position the station accepts. `nil` when nothing is planned, which is the end, and the
/// end is then next.
public func playNextIndex(_ items: [StationOrderItem]) -> Int? {
    RunningOrderUiState(items: items).firstPlannedIndex
}

/// One search result as the list draws it.
///
/// `addable` is whether the station holds the audio. It refuses a record it would have to fetch first,
/// so a row without it offers nothing rather than a button that could only ever be refused. Having the
/// audio does not promise the add lands: the station still applies its own rules.
public struct AddRow: Equatable, Sendable {
    public let id: UUID
    public let title: String
    public let credit: String
    public let durationMs: Int?
    public let addable: Bool

    public init(_ row: TrackRow) {
        id = row.id
        title = row.title
        credit = row.artists
        durationMs = row.durationMs
        addable = row.hasAudio
    }
}

extension TrackDetail {
    /// Whether the station holds this record's audio, as far as a record's own page can tell. The
    /// library list is told outright (`TrackRow.hasAudio`); the page is not, and the nearest thing it
    /// carries is a copy's byte count, which only a fetch that landed writes. If the two ever disagree
    /// the station still decides, and its 422 says so.
    public var hasLocalAudio: Bool { bindings.contains { $0.byteSize != nil } }
}
