@testable import DeadairCore
import DeadairSdk
import Testing

/// What the Now playing screen says.
///
/// Asserted as `Message` values rather than sentences: the sentences live in the string catalog,
/// where they can be translated, and what this guards is that the right one is chosen. "Off air" is
/// the RESTING state of an audience-gated station, so it must not be the fault message.
struct NowPlayingUiStateTests {
    private func state(
        _ air: AirState, listeners: Int = 0, playing: Bool = false, buffering: Bool = false, stale: Bool = false, fellBack: Bool = false, show: NowPlayingShow? = nil
    ) -> NowPlayingUiState {
        NowPlayingUiState(air: air, listeners: listeners, format: .mp3, playing: playing, buffering: buffering, fellBackToMp3: fellBack, stale: stale, show: show)
    }

    private let track = NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", album: "Windowlicker", startedAt: 1)
    /// The station talking between records, as `/nowplaying` reports it: its own label, no artist.
    private let spoken = NowPlayingTrack(kind: .break, title: "Top of the hour", artist: "", startedAt: 1)

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

    @Test func namesWhoIsPresentingUnderTheCredit() {
        #expect(state(.onAir(track), show: NowPlayingShow(name: "Late Static", host: "Cass")).hostLine == .withHost("Cass"))
    }

    @Test func neverDrawsTheShowsNameWhichIsTheOperatorsLabelAndMayBeTheStationsMadeUpOne() {
        #expect(state(.onAir(track), show: NowPlayingShow(name: "From Spotify")).hostLine == nil)
    }

    @Test func hasNoHostLineWhenNobodyPresentsOrTheStationIsNotOnAir() {
        #expect(state(.onAir(track)).hostLine == nil)
        #expect(state(.onAir(track), show: NowPlayingShow(name: "Overnight", host: "")).hostLine == nil)
        // A stale presenter over "can't reach the station" would name somebody nobody can hear.
        #expect(state(.unreachable, stale: true, show: NowPlayingShow(name: "Late Static", host: "Cass")).hostLine == nil)
    }

    @Test func hasNoHostLineDuringABreakWhoseTitleAlreadySaysWhoIsOnTheMic() {
        #expect(state(.onAir(spoken), show: NowPlayingShow(name: "Late Static", host: "Cass")).hostLine == nil)
    }

    @Test func saysTheHostIsOnTheMicDuringABreakWithTheBreaksLabelUnderIt() {
        let ui = state(.onAir(spoken), show: NowPlayingShow(name: "Late Static", host: "Cass"))

        #expect(ui.title == .onTheMic(host: "Cass"))
        #expect(ui.subtitle == .text("Top of the hour"))
        // A break has no album.
        #expect(ui.album == nil)
    }

    @Test func saysTheHostIsOnTheMicEvenWhenTheStationNamesNobody() {
        #expect(state(.onAir(spoken)).title == .onTheMic(host: nil))
        #expect(state(.onAir(spoken), show: NowPlayingShow(name: "Overnight")).title == .onTheMic(host: nil))
    }

    @Test func treatsARecordFromAStationOlderThanKindAsARecord() {
        // The SDK's default: a station that predates the field sends no kind, and that is a record.
        #expect(state(.onAir(NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", startedAt: 1))).title == .text("Windowlicker"))
    }

    @Test func restsOnlyWhileARecordIsComingOutOfThePhone() {
        let record = NowPlayingTrack(title: "Carriageway", artist: "Pale Arcs", startedAt: 1)

        #expect(state(.onAir(record), playing: true).canRest)
        // Stopped, still warming up, or reading something that is no longer true: the words are the news.
        #expect(!state(.onAir(record)).canRest)
        #expect(!state(.onAir(record), playing: true, buffering: true).canRest)
        #expect(!state(.onAir(record), playing: true, stale: true).canRest)
        #expect(!state(.warmingUp, playing: true).canRest)
        #expect(!state(.offAir, playing: true).canRest)
    }
}
