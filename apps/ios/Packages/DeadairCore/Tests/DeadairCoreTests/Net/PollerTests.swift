@testable import DeadairCore
import Testing

/// The loop every polled reading in the app goes through.
///
/// The steady interval here is one second and the grace five, so a recorded wait says which of
/// the two it was for.
@MainActor
struct PollerTests {
    private let schedule = PollSchedule(steady: .seconds(1), ceiling: .seconds(8))

    @Test func waitsSteadilyWhileItWorksAndDoublesWhileItDoesNot() {
        #expect(schedule.interval(afterFailures: 0) == .seconds(1))
        #expect(schedule.interval(afterFailures: 1) == .seconds(2))
        #expect(schedule.interval(afterFailures: 2) == .seconds(4))
        #expect(schedule.interval(afterFailures: 3) == .seconds(8))
        #expect(schedule.interval(afterFailures: 30) == .seconds(8))
    }

    @Test func publishesAnAnswerAndThenKeepsItThroughAFailureMarkedStale() async {
        let script = Script<Int>([.success(1), .failure(Refused())])
        let sleeps = Sleeps()
        let poller = Poller(schedule: schedule, sleep: sleeps.sleep) { try await script.next() }

        let lease = poller.subscribe()
        #expect(await eventually { poller.state.latest?.value == 1 })
        #expect(!poller.state.isStale)

        poller.kick()
        #expect(await eventually { poller.state.isStale })
        #expect(poller.state.latest?.value == 1)
        // The wait after a failure is backed off.
        #expect(await eventually { sleeps.recorded == [.seconds(1), .seconds(2)] })
        lease.release()
    }

    @Test func aKickForgetsTheBackoff() async {
        let script = Script<Int>([.failure(Refused()), .failure(Refused()), .failure(Refused())])
        let sleeps = Sleeps()
        let poller = Poller(schedule: schedule, sleep: sleeps.sleep) { try await script.next() }

        let lease = poller.subscribe()
        #expect(await eventually { sleeps.recorded.count == 1 })
        poller.kick()
        #expect(await eventually { sleeps.recorded.count == 2 })

        // Two failures in a row would have waited four seconds after the second. The kick was a
        // listener saying "try now", so the count started again.
        #expect(sleeps.recorded == [.seconds(2), .seconds(2)])
        lease.release()
    }

    @Test func stopsAskingOnceTheLastLeaseIsReleased() async {
        let script = Script<Int>([.success(1)])
        let sleeps = Sleeps(immediately: [.seconds(5)])
        let poller = Poller(schedule: schedule, sleep: sleeps.sleep) { try await script.next() }

        let lease = poller.subscribe()
        #expect(await eventually { poller.state.latest?.value == 1 })
        lease.release()
        // Released twice is harmless, and does not take a lease somebody else holds.
        lease.release()

        poller.kick()
        try? await Task.sleep(for: .milliseconds(50))
        #expect(script.calls == 1)

        // A new lease starts it again.
        let again = poller.subscribe()
        #expect(await eventually { script.calls == 2 })
        again.release()
    }

    @Test func aRestartForgetsTheOldAnswer() async {
        let script = Script<Int>([.success(1)])
        let sleeps = Sleeps()
        let poller = Poller(schedule: schedule, sleep: sleeps.sleep) { try await script.next() }

        let lease = poller.subscribe()
        #expect(await eventually { poller.state.latest?.value == 1 })

        poller.restart()
        #expect(poller.state == .loading)
        #expect(await eventually { script.calls == 2 })
        lease.release()
    }
}
