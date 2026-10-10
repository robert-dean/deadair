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
        return (NowPlayingGate(schedule: clock.schedule, push: { pushes.record($0) }), pushes)
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

    @Test func aTitleChangeWithNoHeldReadingAsksTheStationAndPublishesThatAnswerAtOnce() {
        var refreshes = 0
        let pushes = Pushes()
        let gate = NowPlayingGate(schedule: clock.schedule, refresh: { refreshes += 1 }, push: { pushes.record($0) })
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        // The poll has not seen the new record yet, so the reading in hand is the one that just
        // ended. Pushing it again would put the previous title up at the exact moment the listener
        // started hearing the next one, which is what this used to do.
        gate.onTitle("Someone Else - Another Song")
        #expect(refreshes == 1)
        #expect(pushes.count == 1)

        // The answer the refresh asked for. The title change already proved the audio is there, so
        // it goes up now rather than waiting out a buffer it has already outlived.
        let next = reading(startedAt: 2_000, title: "Another Song")
        gate.onPoll(next, buffered: .seconds(30))
        #expect(pushes.count == 2)
        #expect(pushes.last == next)

        clock.advance(by: .seconds(60))
        #expect(pushes.count == 2)
    }

    @Test func aReadingTakenAWhileAgoIsHeldOnlyForTheBufferItHasNotOutlived() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        // Twenty seconds of buffer, but the reading that says the record moved was taken fifteen
        // seconds ago, so five seconds of that buffer are left to play.
        gate.onPoll(reading(startedAt: 2_000), buffered: .seconds(20), age: .seconds(15))
        clock.advance(by: .milliseconds(4_999))
        #expect(pushes.count == 1)
        clock.advance(by: .milliseconds(2))
        #expect(pushes.count == 2)
    }

    @Test func aReadingOlderThanTheBufferIsNotHeldAtAll() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        // A negative wait must not become a long one.
        gate.onPoll(reading(startedAt: 2_000), buffered: .seconds(5), age: .seconds(30))
        clock.advance(by: .milliseconds(1))
        #expect(pushes.count == 2)
    }

    @Test func theReleasedReadingIsStampedAWholeBufferAfterItWasRead() {
        var aired: Reading<NowPlaying>?
        let gate = NowPlayingGate(schedule: clock.schedule, aired: { aired = $0 })
        let read = clock.instant

        // The listener hears what the station was doing at `read` eight seconds later, and a
        // playhead projected from `read` would run those eight seconds ahead of the audio. The age
        // decides the hold, not the stamp.
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(8), age: .seconds(20), readAt: read)

        #expect(aired == Reading(reading(startedAt: 1_000), readAt: read.advanced(by: .seconds(8))))
    }

    @Test func anUnmovedReadingReanchorsThePlayheadEvenWhenTheLockScreenIsLeftAlone() {
        var aired: [Reading<NowPlaying>?] = []
        let pushes = Pushes()
        let gate = NowPlayingGate(schedule: clock.schedule, aired: { aired.append($0) }, push: { pushes.record($0) })
        let read = clock.instant

        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5), readAt: read)
        gate.onPoll(reading(startedAt: 1_000, listeners: 99), buffered: .seconds(5), readAt: read.advanced(by: .seconds(3)))

        #expect(pushes.count == 1)
        #expect(aired.map { $0?.readAt } == [read.advanced(by: .seconds(5)), read.advanced(by: .seconds(8))])
    }

    @Test func aMovedRecordReachesTheScreensWhenItReachesTheLockScreenAndNotBefore() {
        var aired: Reading<NowPlaying>?
        let gate = NowPlayingGate(schedule: clock.schedule, aired: { aired = $0 })
        let read = clock.instant
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5), readAt: read)

        let moved = reading(startedAt: 2_000, title: "Next")
        gate.onPoll(moved, buffered: .seconds(4), readAt: read.advanced(by: .seconds(3)))
        // Held: the screens keep drawing the record the listener is still hearing.
        #expect(aired?.value.track?.title == "A Song")

        clock.advance(by: .milliseconds(4_001))
        #expect(aired == Reading(moved, readAt: read.advanced(by: .seconds(7))))
    }

    @Test func aTitleReleaseHandsTheScreensTheHeldReadingWithItsStamp() {
        var aired: Reading<NowPlaying>?
        let gate = NowPlayingGate(schedule: clock.schedule, aired: { aired = $0 })
        let read = clock.instant
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5), readAt: read)
        let moved = reading(startedAt: 2_000, title: "Next")
        gate.onPoll(moved, buffered: .seconds(30), readAt: read.advanced(by: .seconds(3)))

        gate.onTitle("Someone - Next")

        #expect(aired == Reading(moved, readAt: read.advanced(by: .seconds(33))))
    }

    @Test func aRepeatedTitleIsNotAChange() {
        let (gate, pushes) = gate()
        gate.onPoll(reading(startedAt: 1_000), buffered: .seconds(5))

        gate.onTitle("Someone - A Song")
        gate.onTitle("Someone - A Song")

        // The first asked the station and published nothing yet; a repeat asks nothing more.
        #expect(pushes.count == 1)
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

    @Test func aChangeOfHostDuringABreakReachesTheLockScreenWithNothingAboutTheItemMoving() {
        // The lock screen draws a break from the host's name, so a recast mid-break changes what it
        // says while the item, its title and its `startedAt` all stay put.
        let (gate, pushes) = gate()
        let spoken = NowPlayingTrack(kind: .break, title: "Top of the hour", artist: "", startedAt: 1_000)
        let before = NowPlaying(station: "Test FM", onAir: true, listeners: 1, mounts: [], show: NowPlayingShow(name: "Late Static", host: "Cass"), track: spoken)
        var after = before
        after.show = NowPlayingShow(name: "Late Static", host: "Ray")

        gate.onPoll(before, buffered: .seconds(5))
        gate.onPoll(after, buffered: .seconds(5))

        #expect(pushes.count == 2)
        #expect(pushes.last == after)
    }

    @Test func aNewPictureOfTheHostReachesTheLockScreenWithNothingElseMoving() {
        // A break's artwork is the host's picture, so a picture arriving mid-break is a change the
        // lock screen shows.
        let (gate, pushes) = gate()
        let spoken = NowPlayingTrack(kind: .break, title: "Top of the hour", artist: "", startedAt: 1_000)
        let before = NowPlaying(station: "Test FM", onAir: true, listeners: 1, mounts: [], show: NowPlayingShow(name: "Late Static", host: "Cass"), track: spoken)
        var after = before
        after.show = NowPlayingShow(name: "Late Static", host: "Cass", hostArtUrl: "art/portrait-1/cover.png")

        gate.onPoll(before, buffered: .seconds(5))
        gate.onPoll(after, buffered: .seconds(5))

        #expect(pushes.count == 2)
        #expect(pushes.last == after)
    }
}

@MainActor
final class Pushes {
    private(set) var all: [NowPlaying?] = []

    var count: Int { all.count }
    var last: NowPlaying?? { all.last }

    func record(_ reading: NowPlaying?) { all.append(reading) }
}
