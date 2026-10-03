@testable import DeadairCore
import Testing

/// What a listener is told, for each thing the player can do.
///
/// The cases are the ones where the obvious reading is wrong: a station that is waking up looks
/// exactly like a station that is broken, and a two-second stall looks exactly like a dropped
/// connection. The desktop app's `PlaybackConductorTests`, case for case.
@MainActor
struct PlaybackConductorTests {
    private let clock = ManualClock()

    private func conductor(offlineLimit: Duration = .seconds(15 * 60)) -> PlaybackConductor {
        PlaybackConductor(schedule: clock.schedule, offlineLimit: offlineLimit)
    }

    @Test func saysWarmingUpBeforeAnyAudioArrives() {
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.opening)

        #expect(conductor.state == .warmingUp)
    }

    @Test func treatsAFailureBeforeTheFirstAudioAsWarmUpNotAsAFault() {
        // The case this type exists for. Connecting is what puts an audience-gated station on
        // air, so the first attempts can legitimately fail while it takes its lease.
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.failed)

        #expect(conductor.state == .warmingUp)
        #expect(conductor.retryIn == .seconds(1))
    }

    @Test func saysReconnectingOnlyAfterAudioHasActuallyBeenHeard() {
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.playing)
        conductor.observed(.failed)

        #expect(conductor.state == .reconnecting)
    }

    @Test func keepsSayingPlayingThroughAStallOnceAudioHasBeenHeard() {
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.playing)
        conductor.observed(.buffering)

        #expect(conductor.state == .playing)
    }

    @Test func givesUpOnlyAfterTheBackoffIsSpent() {
        let conductor = conductor()
        conductor.requested()

        var states: [ListeningState] = []
        for _ in 0..<40 {
            conductor.observed(.playing)
            conductor.observed(.failed)
            states.append(conductor.state)
        }

        // Each success resets the clock, so a poor connection is reconnected rather than given up on.
        #expect(states.allSatisfy { $0 == .reconnecting })
    }

    @Test func saysUnreachableOnceTheAttemptsHaveSpannedTheGiveUpWindow() {
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.playing)

        for _ in 0..<30 { conductor.observed(.failed) }

        #expect(conductor.state == .unreachable)
    }

    @Test func onceExhaustedAdvancingPastTheCeilingRaisesNoRetry() {
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.playing)
        for _ in 0..<30 { conductor.observed(.failed) }

        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        clock.advance(by: .seconds(60))

        #expect(fired == 0)
    }

    @Test func stoppingEndsItAndAPlayerStillSettlingDoesNotUndoThat() {
        // A player reports its way down after being told to stop. None of that may put the app
        // back into reconnecting, or pressing stop would start a retry loop.
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.playing)

        conductor.released()
        conductor.observed(.failed)
        conductor.observed(.stopped)

        #expect(conductor.state == .stopped)
        #expect(clock.scheduled == 0)
    }

    @Test func aPlayerThatStopsByItselfIsADropAndIsRetried() {
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.playing)

        conductor.observed(.stopped)

        #expect(conductor.state == .reconnecting)
        #expect(conductor.retryIn == .seconds(1))
    }

    @Test func firesTheRetryOnceItIsDueAndNotBefore() {
        let conductor = conductor()
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)
        conductor.observed(.failed)

        clock.advance(by: .milliseconds(999))
        #expect(fired == 0)
        clock.advance(by: .milliseconds(1))
        #expect(fired == 1)
    }

    @Test func releasedBeforeTheRetryIsDueMeansItNeverFires() {
        let conductor = conductor()
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)
        conductor.observed(.failed)

        conductor.released()
        clock.advance(by: .seconds(5))

        #expect(fired == 0)
    }

    @Test func reachingPlayingBeforeTheRetryIsDueMeansItNeverFires() {
        let conductor = conductor()
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)
        conductor.observed(.failed)

        conductor.observed(.playing)
        clock.advance(by: .seconds(5))

        #expect(fired == 0)
    }

    @Test func aSecondFailureRearmsWithTheLongerBackoff() {
        let conductor = conductor()
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)
        conductor.observed(.failed)
        conductor.observed(.failed)

        // The first failure's timer was replaced rather than left to fire beside the second.
        #expect(conductor.retryIn == .seconds(2))
        clock.advance(by: .milliseconds(1_999))
        #expect(fired == 0)
        clock.advance(by: .milliseconds(1))
        #expect(fired == 1)
    }

    @Test func withNoNetworkADropWaitsForOneRatherThanSpendingTheBackoff() {
        let conductor = conductor()
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)

        conductor.networkChanged(available: false)
        // Ten minutes of failures, twice the backoff's budget, and none of them is retried or
        // gives up: there is nothing to retry against.
        for _ in 0..<20 {
            conductor.observed(.failed)
            clock.advance(by: .seconds(30))
        }

        #expect(fired == 0)
        #expect(conductor.state == .reconnecting)
        #expect(conductor.awaitingNetwork)
        #expect(conductor.retryIn == nil)
    }

    @Test func theNetworkComingBackMakesTheRetryDueAtOnce() {
        let conductor = conductor()
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)
        conductor.networkChanged(available: false)
        conductor.observed(.failed)

        clock.advance(by: .seconds(60))
        conductor.networkChanged(available: true)

        #expect(fired == 1)
        #expect(!conductor.awaitingNetwork)
    }

    @Test func theNetworkComingBackStartsTheBackoffAgainFromASecond() {
        let conductor = conductor()
        conductor.requested()
        conductor.observed(.playing)
        for _ in 0..<5 { conductor.observed(.failed) }
        #expect(conductor.retryIn == .seconds(16))

        conductor.networkChanged(available: false)
        conductor.observed(.failed)
        conductor.networkChanged(available: true)
        // The attempt made on the network's return failed too: a second, not thirty.
        conductor.observed(.failed)

        #expect(conductor.retryIn == .seconds(1))
    }

    @Test func losingTheNetworkHoldsARetryThatWasAlreadyScheduled() {
        let conductor = conductor()
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)
        conductor.observed(.failed)

        conductor.networkChanged(available: false)
        clock.advance(by: .seconds(60))
        #expect(fired == 0)
        #expect(conductor.awaitingNetwork)

        conductor.networkChanged(available: true)
        #expect(fired == 1)
    }

    @Test func losingTheNetworkWhilePlayingDoesNothingUntilThePlayerFails() {
        // A handover with audio still in the buffer, and the new network up before it ran out.
        let conductor = conductor()
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)

        conductor.networkChanged(available: false)
        conductor.networkChanged(available: true)
        clock.advance(by: .seconds(60))

        #expect(fired == 0)
        #expect(conductor.state == .playing)
        #expect(!conductor.awaitingNetwork)
    }

    @Test func aFailureBeforeAnyAudioWithNoNetworkIsStillWarmUp() {
        let conductor = conductor()
        conductor.networkChanged(available: false)
        conductor.requested()
        conductor.observed(.failed)

        #expect(conductor.state == .warmingUp)
        #expect(conductor.awaitingNetwork)
    }

    @Test func waitingForTheNetworkEndsUnreachableAfterItsOwnLimit() {
        let conductor = conductor(offlineLimit: .seconds(60))
        var gaveUp = 0
        conductor.onGaveUpWaiting = { gaveUp += 1 }
        conductor.requested()
        conductor.observed(.playing)
        conductor.networkChanged(available: false)
        conductor.observed(.failed)

        clock.advance(by: .seconds(30))
        // A second failure while already waiting does not start the limit again.
        conductor.observed(.failed)
        clock.advance(by: .milliseconds(29_999))
        #expect(conductor.state == .reconnecting)

        clock.advance(by: .milliseconds(1))
        #expect(conductor.state == .unreachable)
        #expect(!conductor.awaitingNetwork)
        #expect(gaveUp == 1)
    }

    @Test func stoppingEndsTheWaitForTheNetwork() {
        let conductor = conductor(offlineLimit: .seconds(60))
        var fired = 0
        conductor.onRetryDue = { fired += 1 }
        conductor.requested()
        conductor.observed(.playing)
        conductor.networkChanged(available: false)
        conductor.observed(.failed)

        conductor.released()
        clock.advance(by: .seconds(120))
        conductor.networkChanged(available: true)

        #expect(fired == 0)
        #expect(conductor.state == .stopped)
        #expect(clock.scheduled == 0)
    }
}
