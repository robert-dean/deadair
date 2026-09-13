@testable import DeadairCore
import Testing

/// Whether opening the app starts the station.
struct OpenPlayTests {
    private let on = ListenerSettings(station: station("https://radio.example.com"), playOnOpen: true)

    @Test func playsOnceOnAnOpenWithAStationAndTheSettingOn() {
        var open = OpenPlay()

        let plays = open.shouldPlay(on)

        #expect(plays)
    }

    @Test func doesNotPlayAgainWhenAskedASecondTimeWhichIsAReturnRatherThanAnOpen() {
        var open = OpenPlay()
        _ = open.shouldPlay(on)

        let again = open.shouldPlay(on)

        #expect(!again)
    }

    @Test func doesNotPlayWithoutAStationAndSoNeverAfterFinishingSetup() {
        var open = OpenPlay()

        let inSetup = open.shouldPlay(ListenerSettings(playOnOpen: true))
        // The station kept during Setup arrives after the one ask a process gets.
        let afterSetup = open.shouldPlay(on)

        #expect(!inSetup)
        #expect(!afterSetup)
    }

    @Test func doesNotPlayWhenOff() {
        var open = OpenPlay()

        let plays = open.shouldPlay(ListenerSettings(station: on.station))

        #expect(!plays)
    }
}
