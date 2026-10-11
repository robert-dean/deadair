@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// When the Live Activity starts, moves and ends, and what it carries.
struct StationActivityTests {
    private let record = NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", startedAt: 1)
    private let next = NowPlayingTrack(title: "Flim", artist: "Aphex Twin", startedAt: 2)
    private let at = Date(timeIntervalSince1970: 1_800_000_000)

    private func state(_ track: NowPlayingTrack?, playback: WidgetPlayback = .playing, readAt: Date? = nil) -> WidgetState {
        let reading = NowPlaying(station: "Static", onAir: track != nil, listeners: 1, mounts: [], show: NowPlayingShow(name: "Late Static", host: "Cass"), track: track)
        return WidgetState(snapshot: snapshotOf(reading, station: station(), stationName: "Static", readAt: readAt ?? at), playback: playback, hasStation: true)
    }

    private let playhead = Playhead(elapsedMs: 60_000, remainingMs: 120_000, durationMs: 180_000)

    @Test func thePlayheadIsTwoWallClockMomentsAroundNow() {
        let content = stationActivityContent(state(record), playhead: playhead, now: at)

        #expect(content.playheadEnd == at.addingTimeInterval(120))
        #expect(content.playheadStart == at.addingTimeInterval(-60))
    }

    @Test func noPlayheadWithoutOneOrWithNothingOnAir() {
        #expect(stationActivityContent(state(record), playhead: nil, now: at).playheadEnd == nil)
        #expect(stationActivityContent(state(nil, playback: .warmingUp), playhead: playhead, now: at).playheadEnd == nil)
    }

    @Test func leavesTheAgeOutSoAMinutePassingChangesNothing() {
        let first = stationActivityContent(state(record), playhead: nil, now: at)
        let later = stationActivityContent(state(record, readAt: at.addingTimeInterval(60)), playhead: nil, now: at.addingTimeInterval(60))

        #expect(first.state.snapshot.readAt == nil)
        #expect(first == later)
    }

    @Test func startsWhenPlayingBegins() {
        let content = stationActivityContent(state(nil, playback: .warmingUp), playhead: nil, now: at)

        #expect(stationActivityStep(enabled: true, requested: true, running: nil, next: content) == .start(content))
    }

    @Test func neverStartsWithTheSettingOffOrWhileStopped() {
        let content = stationActivityContent(state(record), playhead: nil, now: at)

        #expect(stationActivityStep(enabled: false, requested: true, running: nil, next: content) == .none)
        #expect(stationActivityStep(enabled: true, requested: false, running: nil, next: content) == .none)
    }

    @Test func endsOnStopAndWhenTheSettingIsTurnedOff() {
        let content = stationActivityContent(state(record), playhead: nil, now: at)

        #expect(stationActivityStep(enabled: true, requested: false, running: content, next: content) == .end)
        #expect(stationActivityStep(enabled: false, requested: true, running: content, next: content) == .end)
    }

    @Test func updatesWhenTheRecordChanges() {
        let running = stationActivityContent(state(record), playhead: playhead, now: at)
        let moved = stationActivityContent(state(next), playhead: playhead, now: at.addingTimeInterval(120))

        #expect(stationActivityStep(enabled: true, requested: true, running: running, next: moved) == .update(moved))
    }

    @Test func aReAnchoredPlayheadIsNotWorthAnUpdateUntilItMovesTwoSeconds() {
        let running = stationActivityContent(state(record), playhead: playhead, now: at)
        let jitter = stationActivityContent(state(record), playhead: playhead, now: at.addingTimeInterval(1.5))
        let jump = stationActivityContent(state(record), playhead: playhead, now: at.addingTimeInterval(2))

        #expect(stationActivityStep(enabled: true, requested: true, running: running, next: jitter) == .none)
        #expect(stationActivityStep(enabled: true, requested: true, running: running, next: jump) == .update(jump))
    }

    @Test func aPlayheadArrivingOrGoingIsWorthAnUpdate() {
        let without = stationActivityContent(state(record), playhead: nil, now: at)
        let with = stationActivityContent(state(record), playhead: playhead, now: at)

        #expect(worthUpdating(without, with))
        #expect(worthUpdating(with, without))
    }

    @Test func warmUpBecomingPlayingIsWorthAnUpdate() {
        let warming = stationActivityContent(state(record, playback: .warmingUp), playhead: nil, now: at)
        let playing = stationActivityContent(state(record), playhead: nil, now: at)

        #expect(worthUpdating(warming, playing))
    }

    @Test func roundTripsThroughJson() throws {
        let content = stationActivityContent(state(record), playhead: playhead, now: at)

        #expect(try JSONDecoder().decode(StationActivityContent.self, from: JSONEncoder().encode(content)) == content)
    }
}
