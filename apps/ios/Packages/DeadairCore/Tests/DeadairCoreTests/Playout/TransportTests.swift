@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// Which of the operator's controls are worth pressing. `apps/android`'s `TransportUiStateTest`.
struct TransportUiStateTests {
    @Test func theLiveStationCanBeSkippedAndNamesTheRecordOnAir() {
        let ui = TransportUiState(status: LivePlayout.status, air: LivePlayout.air)
        #expect(ui.skipEnabled)
        #expect(!ui.showsStart)
        #expect(ui.airMode == .audience)
        #expect(ui.onAirTrackId != nil)
    }

    @Test func nothingOnAirIsNothingToCutAndNoStreamCannotTakeASkip() {
        var silent = LivePlayout.status
        silent.nowPlaying = nil
        #expect(!TransportUiState(status: silent, air: nil).skipEnabled)

        var down = LivePlayout.status
        down.streamUp = false
        #expect(!TransportUiState(status: down, air: nil).skipEnabled)
    }

    @Test func anActionInFlightHoldsEveryControl() {
        #expect(!TransportUiState(status: LivePlayout.status, air: LivePlayout.air, busy: true).skipEnabled)
    }

    @Test func aStoodDownStationShowsStartButStopUntilTheAirReadingArrives() {
        var stood = LivePlayout.air
        stood.active = false
        #expect(TransportUiState(status: LivePlayout.status, air: stood).showsStart)
        #expect(!TransportUiState(status: LivePlayout.status, air: nil).showsStart)
    }
}

/// The two polls, and an action's answer standing in for them.
@MainActor
struct PlayoutRepositoryTests {
    @Test func pollsStatusEveryTwoSecondsAndAirEveryFive() async {
        let statuses = Script<PlayoutStatus>([.success(LivePlayout.status)])
        let airs = Script<StationAir>([.success(LivePlayout.air)])
        let sleeps = Sleeps()
        let playout = PlayoutRepository(sleep: sleeps.sleep, readStatus: { try await statuses.next() }, readAir: { try await airs.next() })

        let holder = Task { await playout.hold() }
        #expect(await eventually { playout.state(signedIn: true).air != nil })
        #expect(await eventually { Set(sleeps.recorded) == [.seconds(2), .seconds(5)] })
        holder.cancel()
    }

    @Test func anActionsAnswerStandsUntilTheNextPoll() async {
        var skipped = LivePlayout.status
        skipped.listeners = 99
        let statuses = Script<PlayoutStatus>([.success(LivePlayout.status), .success(LivePlayout.status)])
        let playout = PlayoutRepository(sleep: Sleeps().sleep, readStatus: { try await statuses.next() }, readAir: { LivePlayout.air })

        let holder = Task { await playout.hold() }
        #expect(await eventually { playout.state(signedIn: true).status?.listeners == 1 })
        playout.apply(skipped)
        #expect(playout.state(signedIn: true).status?.listeners == 99)
        playout.retry()
        #expect(await eventually { playout.state(signedIn: true).status?.listeners == 1 })
        holder.cancel()
    }

    @Test func signedOutBeatsTheReadingAndAStatusNeverReadIsUnreachable() async {
        let playout = PlayoutRepository(sleep: Sleeps().sleep, readStatus: { throw Refused() }, readAir: { LivePlayout.air })
        let holder = Task { await playout.hold() }
        #expect(await eventually { playout.state(signedIn: true) == .unreachable })
        #expect(playout.state(signedIn: false) == .signedOut)
        holder.cancel()
    }

    @Test func aSkipAppliesTheStationsAnswerAndLooksAgainThreeTimes() async {
        var after = LivePlayout.status
        after.listeners = 7
        let answer = String(decoding: try! JSONEncoder().encode(after), as: UTF8.self)
        let fake = FakeStation { request in
            request.path.hasSuffix("/skip") ? .json(answer) : .json("{}", status: 500)
        }
        let session = OperatorActionsTests.Session(fake)
        let sleeps = Sleeps(immediately: Set(PlayoutRepository.followUps))
        let reads = Script<PlayoutStatus>([])
        let playout = PlayoutRepository(sleep: sleeps.sleep, readStatus: { try await reads.next() }, readAir: { LivePlayout.air })
        let transport = Transport(actions: OperatorActions(session: session, toasts: Toasts()), playout: playout)

        await transport.skip()

        #expect(playout.applied?.listeners == 7)
        #expect(fake.requests.map(\.path).contains { $0.hasSuffix("/skip") })
    }
}
