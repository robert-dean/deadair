@testable import DeadairCore
import DeadairSdk
import Testing

/// The sleep timer on a clock the test moves. `SleepTimerTest.kt`, case for case.
@MainActor
struct SleepTimerTests {
    private let clock = ManualClock()

    private final class Recorder {
        var fires = 0
        var volumes: [Float] = []
    }

    private func timer() -> (SleepTimer, Recorder) {
        let recorder = Recorder()
        let timer = SleepTimer(schedule: clock.schedule, now: { [clock] in clock.instant })
        timer.onFire = { recorder.fires += 1 }
        timer.onVolume = { recorder.volumes.append($0) }
        return (timer, recorder)
    }

    private func reading(startedAt: Int, remainingMs: Int?, at readAt: ContinuousClock.Instant) -> Reading<NowPlaying> {
        let track = NowPlayingTrack(title: "A Song", artist: "Someone", durationMs: 200_000, startedAt: startedAt, remainingMs: remainingMs)
        return Reading(NowPlaying(station: "Test FM", onAir: true, listeners: 1, mounts: [], track: track), readAt: readAt)
    }

    @Test func stopsWhenTheTimeIsUpAndNotBefore() {
        let (timer, rec) = timer()

        timer.arm(.minutes(15))
        clock.advance(by: .seconds(15 * 60) - .milliseconds(1))
        #expect(rec.fires == 0)

        clock.advance(by: .milliseconds(2))
        #expect(rec.fires == 1)
        #expect(timer.state == .off)
    }

    @Test func fadesOverTheLastTenSecondsThenStopsThenPutsTheSoundBack() {
        let (timer, rec) = timer()

        timer.arm(.minutes(1))
        // Just short of the fade: this clock runs whatever is due AT the time it is moved to.
        clock.advance(by: .seconds(50) - .milliseconds(1))
        #expect(rec.volumes.isEmpty)

        clock.advance(by: .seconds(10) + .milliseconds(2))
        let fall = rec.volumes.dropLast()
        #expect(!fall.isEmpty)
        #expect(Array(fall) == fall.sorted(by: >))
        #expect((fall.last ?? 1) < 0.2)
        #expect(rec.volumes.last == 1)
        #expect(rec.fires == 1)
    }

    @Test func turningItOffMidFadeCancelsTheStopAndPutsTheSoundBack() {
        let (timer, rec) = timer()

        timer.arm(.minutes(1))
        clock.advance(by: .seconds(55))
        timer.clear()
        clock.advance(by: .seconds(60))

        #expect(rec.fires == 0)
        #expect(rec.volumes.last == 1)
        #expect(timer.state == .off)
    }

    @Test func aSecondChoiceReplacesTheFirst() {
        let (timer, rec) = timer()

        timer.arm(.minutes(15))
        timer.arm(.minutes(30))
        clock.advance(by: .seconds(20 * 60))
        #expect(rec.fires == 0)

        clock.advance(by: .seconds(10 * 60) + .milliseconds(1))
        #expect(rec.fires == 1)
    }

    @Test func afterThisRecordWaitsForTheListenerByTheReadingsAgeAndWhatThePlayerHolds() {
        let (timer, rec) = timer()
        let start = clock.instant
        clock.advance(by: .seconds(5))
        // Read at 0 with 30 s left and 4 s in the player: the listener hears the end at 34 s.
        timer.onReading(reading(startedAt: 1, remainingMs: 30_000, at: start), buffered: .seconds(4))

        timer.arm(.afterRecord)
        #expect(timer.state == .afterRecord(start + .seconds(34)))

        clock.advance(by: .seconds(29) - .milliseconds(1))
        #expect(rec.fires == 0)
        clock.advance(by: .milliseconds(2))
        #expect(rec.fires == 1)
    }

    @Test func afterThisRecordReAnchorsOnEachReadingOfTheSameRecord() {
        let (timer, _) = timer()
        let start = clock.instant
        timer.onReading(reading(startedAt: 1, remainingMs: 30_000, at: start), buffered: .zero)
        timer.arm(.afterRecord)

        clock.advance(by: .seconds(3))
        timer.onReading(reading(startedAt: 1, remainingMs: 40_000, at: clock.instant), buffered: .zero)

        #expect(timer.state == .afterRecord(start + .seconds(43)))
    }

    @Test func afterThisRecordFiresOnceTheBufferDrainsWhenTheRecordMovesOnEarly() {
        let (timer, rec) = timer()
        timer.onReading(reading(startedAt: 1, remainingMs: 120_000, at: clock.instant), buffered: .zero)
        timer.arm(.afterRecord)

        clock.advance(by: .seconds(10))
        timer.onReading(reading(startedAt: 2, remainingMs: 200_000, at: clock.instant), buffered: .seconds(6))

        clock.advance(by: .seconds(6) + .milliseconds(1))
        #expect(rec.fires == 1)
    }

    @Test func afterThisRecordWaitsWithNoDeadlineUntilAReadingCanSay() {
        let (timer, rec) = timer()

        timer.arm(.afterRecord)
        #expect(timer.state == .afterRecord(nil))
        clock.advance(by: .seconds(600))
        #expect(rec.fires == 0)

        timer.onReading(reading(startedAt: 1, remainingMs: 20_000, at: clock.instant), buffered: .zero)
        #expect(timer.state == .afterRecord(clock.instant + .seconds(20)))
    }

    @Test func aStopByHandTurnsItOff() {
        let (timer, rec) = timer()

        timer.arm(.minutes(15))
        timer.onStopped()
        clock.advance(by: .seconds(30 * 60))

        #expect(rec.fires == 0)
        #expect(timer.state == .off)
    }

    @Test func saysHowLongIsLeftRoundedUpSoItNeverSaysZero() {
        let (timer, _) = timer()
        #expect(timer.line(at: clock.instant) == nil)

        timer.arm(.minutes(15))
        #expect(timer.line(at: clock.instant) == .stopsIn(.minutes(15)))
        #expect(timer.line(at: clock.instant + .seconds(14 * 60 + 20)) == .stopsIn(.minutes(1)))

        timer.arm(.minutes(60))
        #expect(timer.line(at: clock.instant) == .stopsIn(.hours(1, minutes: 0)))

        timer.arm(.afterRecord)
        #expect(timer.line(at: clock.instant) == .stopsAfterThisRecord)
    }
}
