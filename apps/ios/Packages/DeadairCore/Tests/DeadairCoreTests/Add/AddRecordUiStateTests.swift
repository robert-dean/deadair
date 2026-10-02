@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// The library search's rules. A blank search is a 400 rather than "everything", and a Play next below
/// the committed head is a 422 rather than clamped, so both are decided here, where a test can see
/// them. `apps/android`'s `AddRecordUiStateTest`, case for case.
struct AddRecordUiStateTests {
    private func row(hasAudio: Bool) -> TrackRow {
        TrackRow(
            id: UUID(uuidString: "5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b")!, title: "Song", artistId: UUID(uuidString: "0c9f3e1a-7b2d-4e8f-a1c3-5d6e7f809a1b")!,
            artistName: "Band", artists: "Band feat. Guest", durationMs: 200_000, rating: .neutral, hasAudio: hasAudio, measured: true, enriched: false
        )
    }

    @Test func aBoxWithNothingWorthAskingAboutIsNotAQuery() {
        #expect(LibrarySearch.term("") == nil)
        #expect(LibrarySearch.term("   ") == nil)
        #expect(LibrarySearch.term("a") == nil)
        #expect(LibrarySearch.term(" a ") == nil)
    }

    @Test func aTermIsSentTrimmed() {
        #expect(LibrarySearch.term("ab") == "ab")
        #expect(LibrarySearch.term("  love will ") == "love will")
    }

    @Test func playNextGoesInFrontOfTheFirstRecordNobodyHasHandedToThePlayer() {
        let items = [orderItem("played", .played), orderItem("airing", .airing), orderItem("handed", .handed), orderItem("next", .planned), orderItem("later", .planned)]
        #expect(playNextIndex(items) == 3)
    }

    @Test func withNothingPlannedTheEndIsNextWhichIsNoPositionAtAll() {
        #expect(playNextIndex([orderItem("airing", .airing)]) == nil)
        #expect(playNextIndex([]) == nil)
    }

    @Test func aRecordTheStationHasNoAudioForOffersNothing() {
        #expect(AddRow(row(hasAudio: true)).addable)
        #expect(!AddRow(row(hasAudio: false)).addable)
    }

    @Test func aRowCarriesTheCreditAsTheReleaseWritesIt() {
        let shown = AddRow(row(hasAudio: true))
        #expect(shown.id.uuidString.lowercased() == "5b0e8a52-3c1f-4d2a-9e7b-0f6c1d2e3a4b")
        #expect(shown.credit == "Band feat. Guest")
        #expect(shown.durationMs == 200_000)
    }
}
