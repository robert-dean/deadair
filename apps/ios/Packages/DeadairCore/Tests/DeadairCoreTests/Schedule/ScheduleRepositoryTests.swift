@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// The schedule's cadence: the clock every half minute, the names only when they have gone stale.
@MainActor
struct ScheduleRepositoryTests {
    private let now = ScheduleNow(now: "2026-09-06 20:30:00", upcoming: [])
    private let slot = ScheduleSlot(id: "slot-1", label: "Late Night", startsAtMinutes: 1200, endsAtMinutes: 1320, mode: .rotation, onEnd: .extend)

    /// How many times each read was asked, and whether the next slot read fails.
    final class Reads: @unchecked Sendable {
        private let lock = NSLock()
        private var counts = (current: 0, slots: 0, personas: 0)
        private var slotFailures: Int

        init(slotFailures: Int = 0) { self.slotFailures = slotFailures }

        var current: Int { lock.withLock { counts.current } }
        var slots: Int { lock.withLock { counts.slots } }

        func readCurrent(_ now: ScheduleNow) -> ScheduleNow {
            lock.withLock { counts.current += 1 }
            return now
        }

        func readSlots(_ slot: ScheduleSlot) throws -> [ScheduleSlot] {
            try lock.withLock {
                counts.slots += 1
                if slotFailures > 0 {
                    slotFailures -= 1
                    throw Refused()
                }
            }
            return [slot]
        }
    }

    private func repository(_ reads: Reads, sleeps: Sleeps = Sleeps()) -> ScheduleRepository {
        let now = now
        let slot = slot
        return ScheduleRepository(
            sleep: sleeps.sleep,
            readCurrent: { reads.readCurrent(now) },
            readSlots: { try reads.readSlots(slot) },
            readPersonas: { [] }
        )
    }

    @Test func pollsTheClockEveryHalfMinuteAndBacksOffWhenItFails() {
        #expect(ScheduleRepository.schedule.interval(afterFailures: 0) == .seconds(30))
        #expect(ScheduleRepository.schedule.interval(afterFailures: 5) == .seconds(300))
    }

    @Test func asksNothingUntilSomebodyHoldsALease() async {
        let reads = Reads()
        _ = repository(reads)

        try? await Task.sleep(for: .milliseconds(30))

        #expect(reads.current == 0)
    }

    @Test func readsTheNamesOnceRatherThanOnEveryPoll() async {
        let reads = Reads()
        let schedule = repository(reads)
        let lease = schedule.subscribe()
        #expect(await eventually { schedule.state.latest?.value.slots == [slot] })

        schedule.retry()
        #expect(await eventually { reads.current == 2 })
        schedule.retry()
        #expect(await eventually { reads.current == 3 })

        #expect(reads.slots == 1)
        lease.release()
    }

    @Test func triesTheNamesAgainAtOnceWhenTheFirstReadOfThemFailed() async {
        // A blip as the screen opens must not leave it without names for half an hour.
        let reads = Reads(slotFailures: 1)
        let schedule = repository(reads)
        let lease = schedule.subscribe()
        #expect(await eventually { schedule.state == .unreachable(lastGood: nil) })

        schedule.retry()

        #expect(await eventually { schedule.state.latest?.value.slots == [slot] })
        #expect(reads.slots == 2)
        lease.release()
    }

    @Test func keepsTheLastGoodReadingWhenTheStationStopsAnswering() async {
        final class Flaky: @unchecked Sendable {
            private let lock = NSLock()
            private var calls = 0
            func read(_ now: ScheduleNow) throws -> ScheduleNow {
                let call = lock.withLock { calls += 1; return calls }
                if call > 1 { throw Refused() }
                return now
            }
        }
        let flaky = Flaky()
        let now = now
        let schedule = ScheduleRepository(sleep: Sleeps().sleep, readCurrent: { try flaky.read(now) }, readSlots: { [] }, readPersonas: { [] })
        let lease = schedule.subscribe()
        #expect(await eventually { schedule.state.latest != nil })

        schedule.retry()

        #expect(await eventually { schedule.state.isStale })
        #expect(schedule.state.latest?.value.now == now)
        lease.release()
    }
}
