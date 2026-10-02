@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// What the providers said, as one panel lays it out. `apps/android`'s `EnrichmentUiStateTest`.
struct EnrichmentUiStateTests {
    private let fetched = Date(timeIntervalSince1970: 1_777_802_400)

    private func provenance(found: Bool = true, failed: Bool = false, stale: Bool = false) -> Provenance {
        Provenance(provider: "musicbrainz", fetchedAt: fetched, stale: stale, found: found, failed: failed)
    }

    private func track(_ data: TrackEnrichmentData) -> EnrichmentUiState {
        EnrichmentUiState(facts: EnrichmentFacts(data), sources: [], claims: [])
    }

    private func scalars(_ ui: EnrichmentUiState) -> [String] { ui.scalars.map(\.value) }

    @Test func isEmptyOnlyWhenNothingHasBeenStoredAtAll() {
        #expect(EnrichmentUiState(facts: EnrichmentFacts(), sources: [], claims: []).isEmpty)
        #expect(!EnrichmentUiState(facts: EnrichmentFacts(), sources: [provenance(found: false)], claims: []).isEmpty)
    }

    @Test func tagsAreTheGenresThenTheMoods() {
        #expect(track(TrackEnrichmentData(genres: ["thrash"], moods: ["angry"])).tags == ["thrash", "angry"])
    }

    @Test func scalarsDropWhatNobodyResolvedAndKeepTheConsolesOrder() {
        let ui = track(TrackEnrichmentData(year: 1990, bpm: 140, musicalKey: "E minor", label: " "))
        #expect(ui.scalars.map(\.field) == [.released, .bpm, .key])
        #expect(scalars(ui) == ["1990", "140", "E minor"])
    }

    @Test func aFullReleaseDateBeatsTheYearWhenItSaysMore() {
        #expect(scalars(track(TrackEnrichmentData(year: 1990, releaseDate: "1990-09-24"))) == ["1990-09-24"])
        #expect(scalars(track(TrackEnrichmentData(year: 1990, releaseDate: "1990"))) == ["1990"])
    }

    @Test func aFractionalTempoKeepsOneDecimal() {
        #expect(scalars(track(TrackEnrichmentData(bpm: 127.5))) == ["127.5"])
    }

    @Test func aProvidersRowIsOneOfFourStatesAndFailedButFoundIsItsOwn() {
        #expect(provenance().state == .found)
        #expect(provenance(found: false).state == .nothingFound)
        #expect(provenance(found: false, failed: true).state == .couldNotAsk)
        #expect(provenance(found: true, failed: true).state == .couldNotReask)
    }

    @Test func anArtistsPayloadCarriesOnlyWhatAnArtistHas() {
        let facts = EnrichmentFacts(ArtistEnrichmentData(biography: "Formed in 1981.", links: [EnrichmentLink(label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Metallica")]))
        #expect(facts.biography == "Formed in 1981.")
        #expect(facts.links.count == 1)
        #expect(EnrichmentUiState(facts: facts, sources: [], claims: []).scalars.isEmpty)
    }
}

/// How a page's one fetch is reported.
struct LoadStateTests {
    @Test func aSignedOutSessionIsA401RatherThanAnError() async throws {
        let state: LoadState<Int> = try await loadState { throw NotSignedIn() }
        #expect(state == .failed(status: 401))
    }

    @Test func theStationsRefusalCarriesItsStatusAndNoAnswerCarriesNone() async throws {
        let refused: LoadState<Int> = try await loadState { throw SdkError(message: "gone", status: 404) }
        let silent: LoadState<Int> = try await loadState { throw URLError(.cannotConnectToHost) }
        #expect(refused == .failed(status: 404))
        #expect(silent == .failed(status: nil))
    }

    @Test func aNotFoundSaysWhatWasNotFoundAndAnythingElseSaysItsStatus() {
        #expect(detailFailure(404, notFound: .albumNotFound) == .albumNotFound)
        #expect(detailFailure(nil, notFound: .albumNotFound) == .cantReachStation)
        #expect(detailFailure(500, notFound: .albumNotFound) == .operatorNotice(.failed(status: 500)))
    }

    @Test func aListSaysHowManyItLeftOut() {
        #expect(ListPage(items: [1, 2], total: 5).notShown == 3)
        #expect(ListPage(items: [1, 2], total: 2).notShown == 0)
    }
}
