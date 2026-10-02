@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// Why the station is or is not heard, as the live station reports it and as it would report a fault.
struct SilenceReadingTests {
    private func check(_ code: SilenceCause, _ state: SilenceState) -> SilenceCheck {
        SilenceCheck(code: code, state: state, detail: "\(code)")
    }

    @Test func theLiveStationIsOnAirWithEveryGateRuledOut() {
        let reading = readSilence(LivePlayout.status.silence)
        #expect(reading.tone == .live)
        #expect(reading.label == .silenceLabel(.airing))
        #expect(reading.otherFaults.isEmpty)
        #expect(reading.ruledOut.count == LivePlayout.status.silence.checks.count)
    }

    @Test func waitingForAListenerIsStandbyAndStoodDownIsOffNeitherAFault() {
        let waiting = StationSilence(audible: false, cause: .noAudience, detail: "Nobody is listening.", checks: [check(.noAudience, .waiting)])
        let stood = StationSilence(audible: false, cause: .stoodDown, detail: "Stood down.", checks: [check(.stoodDown, .waiting)])
        #expect(readSilence(waiting).tone == .standby)
        #expect(readSilence(stood).tone == .off)
    }

    @Test func aFaultNamesItsCauseAndSaysTheOtherFaultsItIsNotBlaming() {
        let silence = StationSilence(
            audible: false, cause: .streamUnreachable, detail: "Icecast is not answering.", remedy: "docker restart deadair-stream",
            checks: [check(.streamUnreachable, .fault), check(.configNotAdopted, .fault), check(.noProgramme, .ok)]
        )
        let reading = readSilence(silence)
        #expect(reading.tone == .fault)
        #expect(reading.title == .silenceTitle(.streamUnreachable))
        #expect(reading.remedy?.isCommand == true)
        #expect(reading.otherFaults.map(\.code) == [.configNotAdopted])
        #expect(reading.ruledOut.map(\.code) == [.noProgramme])
    }

    @Test func aRemedyThatIsNotACommandIsASentence() {
        #expect(Remedy(text: "Wait for the download.").isCommand == false)
    }
}

/// What the desk says above its controls. `apps/android`'s `DeskUiStateTest`.
struct DeskUiStateTests {
    @Test func onAirNamesTheBroadcastAndHowManyAreListening() {
        let ui = DeskUiState(transport: TransportUiState(status: LivePlayout.status, air: LivePlayout.air))
        #expect(ui.onAir)
        #expect(ui.heading == .deskOnAir)
        #expect(ui.line == .goingOut(name: "From Spotify", listeners: 1))
    }

    @Test func aBroadcastWithNoNameIsGoingOutAllTheSame() {
        var air = LivePlayout.air
        air.name = " "
        #expect(DeskUiState(transport: TransportUiState(status: LivePlayout.status, air: air)).line == .goingOut(name: nil, listeners: 1))
    }

    @Test func offAirIsTheStationsVerdictAndTheLineIsItsOwnTitleForWhy() {
        var status = LivePlayout.status
        status.silence = StationSilence(audible: false, cause: .noAudience, detail: "Nobody.", checks: [])
        let ui = DeskUiState(transport: TransportUiState(status: status, air: LivePlayout.air))
        #expect(!ui.onAir)
        #expect(ui.heading == .deskOffAir)
        #expect(ui.line == .silenceTitle(.noAudience))
    }

    @Test func theRecordSaysWhatIsLeftOfItWhenTheStationDoes() {
        var status = LivePlayout.status
        status.nowPlaying?.remainingMs = 161_000
        status.nowPlaying?.item.artists = ["Black Sabbath"]
        let record = DeskUiState(transport: TransportUiState(status: status, air: nil)).record
        #expect(record?.line == .timeLeft(artists: "Black Sabbath", left: "2:41"))
    }

    @Test func withoutARemainingTimeTheRecordIsJustItsArtistsAndBetweenRecordsThereIsNone() {
        var timeless = LivePlayout.status
        timeless.nowPlaying?.remainingMs = nil
        timeless.nowPlaying?.item.artists = ["A", "B"]
        #expect(DeskUiState(transport: TransportUiState(status: timeless, air: nil)).record?.line == .text("A, B"))

        var between = LivePlayout.status
        between.nowPlaying = nil
        #expect(DeskUiState(transport: TransportUiState(status: between, air: nil)).record == nil)
    }
}

/// Who is driving and the hold. `apps/android`'s `TransportUiStateTest`.
struct HoldTests {
    private func ui(source: AirSource, held: Bool = false, until: String? = nil) -> TransportUiState {
        var air = LivePlayout.air
        air.airSource = source
        air.held = held
        air.holdUntil = until
        return TransportUiState(status: LivePlayout.status, air: air)
    }

    @Test func theHoldIsOfferedOnlyWhileAPersonIsDriving() {
        #expect(ui(source: .operator).hold() == .offered)
        #expect(ui(source: .schedule).hold() == nil)
        #expect(ui(source: .sustaining).hold() == nil)
    }

    @Test func aHoldWithNoEndIsHeldUntilReleasedAndOneWithAnEndSaysWhen() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        #expect(ui(source: .operator, held: true).hold(calendar: calendar) == .heldUntilReleased)
        #expect(ui(source: .operator, held: true, until: "2026-10-02T22:30:00.000Z").hold(calendar: calendar) == .heldUntil(Clock(hour: 22, minute: 30)))
    }

    @Test func whoIsDrivingIsSaidInTheAnswersOwnWords() {
        #expect(ui(source: .schedule).driving == .schedulePutThisOn)
        #expect(ui(source: .sustaining).driving == .betweenBlocks)
        #expect(ui(source: .operator).driving == .youPutThisOn)
        #expect(ui(source: .off).driving == nil)
    }
}

/// Take off air arms before it fires. `apps/android`'s `ArmedStopTest`.
struct ArmedStopTests {
    @Test func theFirstPressArmsAndFiresNothing() {
        var stop = ArmedStop()
        let now = ContinuousClock.now
        let fired = stop.press(at: now)
        #expect(!fired)
        #expect(stop.isArmed(at: now))
    }

    @Test func theSecondPressFiresOnceAndDisarms() {
        var stop = ArmedStop()
        let now = ContinuousClock.now
        _ = stop.press(at: now)
        let second = stop.press(at: now + .seconds(2))
        #expect(second)
        #expect(!stop.isArmed(at: now + .seconds(2)))
        let third = stop.press(at: now + .seconds(3))
        #expect(!third)
    }

    @Test func aLapsedArmNeedsTwoPressesAgain() {
        var stop = ArmedStop()
        let now = ContinuousClock.now
        _ = stop.press(at: now)
        #expect(!stop.isArmed(at: now + .seconds(5)))
        let late = stop.press(at: now + .seconds(6))
        #expect(!late)
        let again = stop.press(at: now + .seconds(7))
        #expect(again)
    }
}
