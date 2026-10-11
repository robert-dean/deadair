@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// What the widget's file says about a reading, and when it is worth writing again.
struct WidgetSnapshotTests {
    private let record = NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", artworkUrl: "art/cover-1", startedAt: 1)
    private let spoken = NowPlayingTrack(kind: .break, title: "Top of the hour", artist: "", startedAt: 2)
    private let at = Date(timeIntervalSince1970: 1_800_000_000)

    private func reading(_ track: NowPlayingTrack?, station name: String = "Static", listeners: Int = 1, onAir: Bool = true, host: String? = "Cass") -> NowPlaying {
        NowPlaying(station: name, onAir: onAir, listeners: listeners, mounts: [], show: NowPlayingShow(name: "Late Static", host: host, hostArtUrl: "art/portrait-1/cover.png"), track: track)
    }

    private func snapshot(_ reading: NowPlaying, kept: String? = "Kept", readAt: Date? = nil) -> WidgetSnapshot {
        snapshotOf(reading, station: station(), stationName: kept, readAt: readAt ?? at)
    }

    @Test func namesTheRecordItsArtistAndItsCoverResolvedAgainstTheStation() {
        #expect(snapshot(reading(record)) == WidgetSnapshot(
            stationName: "Static", onAir: true, reachable: true, kind: .record, title: "Windowlicker", artist: "Aphex Twin",
            host: "Cass", artworkUrl: station().artUrl("art/cover-1"), readAt: at
        ))
    }

    @Test func aBreakCarriesItsHostAndThePresentersPortraitAndNoArtist() {
        let made = snapshot(reading(spoken))

        #expect(made.kind == .break)
        #expect(made.artist == nil)
        #expect(made.host == "Cass")
        #expect(made.artworkUrl == station().artUrl("art/portrait-1/cover.png"))
    }

    @Test func theStationsOwnNameWinsAndTheKeptOneStandsInForABlankOne() {
        #expect(snapshot(reading(record, station: "Static")).stationName == "Static")
        #expect(snapshot(reading(record, station: "  ")).stationName == "Kept")
    }

    @Test func offAirHasNoRecordAndNoPicture() {
        let made = snapshot(reading(nil, onAir: false))

        #expect(!made.onAir)
        #expect(made.title == nil)
        #expect(made.artworkUrl == nil)
    }

    @Test func anUnnamedHostIsAbsentRatherThanBlank() {
        #expect(snapshot(reading(spoken, host: " ")).host == nil)
    }

    @Test func roundTripsThroughJson() throws {
        let made = snapshot(reading(spoken))

        let decoded = try JSONDecoder().decode(WidgetSnapshot.self, from: JSONEncoder().encode(made))

        #expect(decoded == made)
    }

    @Test func aMovedListenerCountIsNotWorthDrawing() {
        let before = snapshot(reading(record, listeners: 1))
        let after = snapshot(reading(record, listeners: 9), readAt: at.addingTimeInterval(3))

        #expect(!worthDrawing(before, after))
    }

    @Test func aChangedRecordIsWorthDrawingAtOnce() {
        let before = snapshot(reading(record))
        let after = snapshot(reading(spoken), readAt: at.addingTimeInterval(3))

        #expect(worthDrawing(before, after))
    }

    @Test func theAgeAloneEarnsAWriteOnceAMinute() {
        let before = snapshot(reading(record))

        #expect(!worthDrawing(before, snapshot(reading(record), readAt: at.addingTimeInterval(59))))
        #expect(worthDrawing(before, snapshot(reading(record), readAt: at.addingTimeInterval(60))))
    }

    @Test func aFailedPollIsWorthDrawingThoughNothingElseMoved() {
        let before = snapshot(reading(record))
        var after = before
        after.reachable = false

        #expect(worthDrawing(before, after))
    }

    @Test func theFirstReadingIsWorthDrawingOverAnEmptyFile() {
        var first = WidgetSnapshot(stationName: "Static")
        #expect(!worthDrawing(first, first))

        first.readAt = at
        #expect(worthDrawing(WidgetSnapshot(stationName: "Static"), first))
    }
}
