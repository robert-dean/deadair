@testable import DeadairCore
import DeadairSdk
import Testing

/// The push-timing decision, on a clock the test moves. `NowPlayingGateTest.kt`, case for case.
@MainActor
struct NowPlayingGateTests {
    private let clock = ManualClock()

    private func reading(startedAt: Int, title: String = "A Song", listeners: Int = 1) -> NowPlaying {
        NowPlaying(station: "Test FM", onAir: true, listeners: listeners, mounts: [], track: NowPlayingTrack(title: title, artist: "Someone", startedAt: startedAt))
    }

    /// A gate and a record of what it pushed.
    private func gate() -> (NowPlayingGate, Pushes) {
        let pushes = Pushes()
        return (NowPlayingGate(schedule: clock.schedule) { pushes.record($0) }, pushes)
    }

    @Test func theFirstReadingPushesImmediately() {
        let (gate, pushes) = gate()

        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        #expect(pushes.count == 1)
        #expect(pushes.last == reading(startedAt: 1_000))
    }

    @Test func anUnmovedReadingWithNothingShownDifferentIsNotPushedAgain() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        // Only a field the lock screen does not show has moved.
        gate.onPoll(reading(startedAt: 1_000, listeners: 99), buffered: .seconds(5))

        #expect(pushes.count == 1)
    }

    @Test func anUnmovedReadingPushesAgainWhenSomethingShownChanges() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        let corrected = reading(startedAt: 1_000, title: "A Corrected Title")
        gate.onPoll(corrected, buffered: .seconds(5))

        #expect(pushes.count == 2)
        #expect(pushes.last == corrected)
    }

    @Test func aMovedStartedAtIsHeldUntilTheBufferedDurationElapses() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        let moved = reading(startedAt: 2_000)
        gate.onPoll(moved, buffered: .seconds(4))
        #expect(pushes.count == 1)

        clock.advance(by: .milliseconds(3_999))
        #expect(pushes.count == 1)
        clock.advance(by: .milliseconds(2))
        #expect(pushes.count == 2)
        #expect(pushes.last == moved)
    }

    @Test func repollingTheSameMovedTrackWhileHeldDoesNotRestartTheWait() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))
        gate.onPoll(reading(startedAt: 2_000), buffered: .seconds(3))

        // The same held track seen on the next poll, before its release fires: routine once the
        // buffer outlasts the poll interval, which HLS always does.
        clock.advance(by: .seconds(1))
        let refreshed = reading(startedAt: 2_000, listeners: 42)
        gate.onPoll(refreshed, buffered: .seconds(3))
        #expect(pushes.count == 1)

        clock.advance(by: .milliseconds(1_999))
        #expect(pushes.count == 1)
        clock.advance(by: .milliseconds(2))
        #expect(pushes.count == 2)
        #expect(pushes.last == refreshed)
    }

    @Test func aTitleChangeReleasesTheHeldReadingEarly() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))
        let moved = reading(startedAt: 2_000)
        gate.onPoll(moved, buffered: .seconds(30))

        gate.onTitle("Someone - A Song")
        #expect(pushes.count == 2)
        #expect(pushes.last == moved)

        // The timer that would have released it later is gone.
        clock.advance(by: .seconds(60))
        #expect(pushes.count == 2)
    }

    @Test func aTitleChangeWithNoHeldReadingPushesTheLatest() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        gate.onTitle("Someone - A Song")

        #expect(pushes.count == 2)
        #expect(pushes.last == reading(startedAt: 1_000))
    }

    @Test func aRepeatedTitleIsNotAChange() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        gate.onTitle("Someone - A Song")
        gate.onTitle("Someone - A Song")

        #expect(pushes.count == 2)
    }

    @Test func aTitleChangeBeforeAnyPollDoesNothing() {
        let (gate, pushes) = gate()

        gate.onTitle("Someone - A Song")

        #expect(pushes.count == 0)
    }

    @Test func cancelDropsAPendingRelease() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))
        gate.onPoll(reading(startedAt: 2_000), buffered: .seconds(4))

        gate.cancel()
        clock.advance(by: .seconds(60))

        #expect(pushes.count == 1)
    }

    @Test func anOffAirReadingWithNoTrackPushesOnceAndARepeatOfItDoesNot() {
        let (gate, pushes) = gate()
        let offAir = NowPlaying(station: "Test FM", onAir: false, listeners: 0, mounts: [], track: nil)

        gate.onPoll(offAir, buffered: .seconds(5))
        gate.onPoll(offAir, buffered: .seconds(5))

        #expect(pushes.count == 1)
        #expect(pushes.last == offAir)
    }
}

@MainActor
final class Pushes {
    private(set) var all: [NowPlaying?] = []

    var count: Int { all.count }
    var last: NowPlaying?? { all.last }

    func record(_ reading: NowPlaying?) { all.append(reading) }
}
