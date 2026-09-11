@testable import DeadairCore
import DeadairSdk
import Testing

/// What the Now playing screen says.
///
/// Asserted as `Message` values rather than sentences: the sentences live in the string catalog,
/// where they can be translated, and what this guards is that the right one is chosen. "Off air" is
/// the RESTING state of an audience-gated station, so it must not be the fault message.
struct NowPlayingUiStateTests {
    private func state(_ air: AirState, listeners: Int = 0, stale: Bool = false, fellBack: Bool = false) -> NowPlayingUiState {
        NowPlayingUiState(air: air, listeners: listeners, format: .mp3, playing: false, buffering: false, fellBackToMp3: fellBack, stale: stale)
    }

    private let track = NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", album: "Windowlicker", startedAt: 1)

    @Test func namesTheRecordTheArtistAndTheAlbumWhenOneIsPlaying() {
        let ui = state(.onAir(track))

        #expect(ui.title == .text("Windowlicker"))
        #expect(ui.subtitle == .text("Aphex Twin"))
        #expect(ui.album == "Windowlicker")
    }

    @Test func saysOffAirPlainlyAndSaysWhatThePlayButtonIsFor() {
        let ui = state(.offAir)

        #expect(ui.title == .offAir)
        #expect(ui.subtitle == .quietUntilSomeoneTunesIn)
    }

    @Test func saysTheStationIsComingOnAirRatherThanShowingAStuckSpinner() {
        let ui = state(.warmingUp)

        #expect(ui.title == .warmingUp)
        #expect(ui.subtitle == .comingOnAir)
    }

    @Test func admitsThatWhatIsOnScreenIsStaleWhenTheStationStopsAnswering() {
        #expect(state(.unreachable, stale: true).title == .cantReachStation)
        #expect(state(.unreachable, stale: true).subtitle == .showingLastSaid)
        #expect(state(.unreachable, stale: false).subtitle == nil)
    }

    @Test func handsTheListenerCountToTheLanguageToCount() {
        #expect(state(.offAir, listeners: 0).footer == .listeners(count: 0, format: .mp3))
        #expect(state(.offAir, listeners: 12).footer == .listeners(count: 12, format: .mp3))
    }

    @Test func notesTheFallbackOnlyWhenItHappened() {
        #expect(state(.offAir, fellBack: true).fallbackNote == .fellBackToMp3(wanted: .mp3))
        #expect(state(.offAir).fallbackNote == nil)
    }

    @Test func scrollsACreditAndWrapsASentence() {
        #expect(state(.onAir(track)).subtitleScrolls)
        #expect(!state(.offAir).subtitleScrolls)
        #expect(!state(.warmingUp).subtitleScrolls)
    }

    @Test func hasNoArtistLineForARecordCreditedToNobody() {
        #expect(state(.onAir(NowPlayingTrack(title: "Untitled", artist: "", startedAt: 1))).subtitle == nil)
    }
}
