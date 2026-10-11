@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// What the widget says, when it admits its age, and what the app's readings do to its file.
struct WidgetStateTests {
    private let record = NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", artworkUrl: "art/cover-1", startedAt: 1)
    private let spoken = NowPlayingTrack(kind: .break, title: "Top of the hour", artist: "", startedAt: 2)
    private let at = Date(timeIntervalSince1970: 1_800_000_000)

    private func reading(_ track: NowPlayingTrack?, onAir: Bool = true, host: String? = "Cass") -> NowPlaying {
        NowPlaying(station: "Static", onAir: onAir, listeners: 1, mounts: [], show: NowPlayingShow(name: "Late Static", host: host), track: track)
    }

    private func state(_ reading: NowPlaying?, playback: WidgetPlayback = .playing, hasStation: Bool = true, reachable: Bool = true) -> WidgetState {
        var snapshot = reading.map { snapshotOf($0, station: station(), stationName: "Static", readAt: at) } ?? WidgetSnapshot(stationName: "Static")
        snapshot.reachable = reachable
        return WidgetState(snapshot: snapshot, playback: playback, hasStation: hasStation)
    }

    @Test func playbackIsWarmUpUntilAudioComesOut() {
        #expect(widgetPlayback(requested: false, playing: false) == .stopped)
        #expect(widgetPlayback(requested: true, playing: false) == .warmingUp)
        #expect(widgetPlayback(requested: true, playing: true) == .playing)
    }

    @Test func aRecordIsItsTitleOverItsArtist() {
        #expect(widgetReading(state(reading(record))) == .record(title: "Windowlicker", artist: "Aphex Twin"))
    }

    @Test func aBreakIsWhoIsTalkingAndTheBreaksOwnName() {
        #expect(widgetReading(state(reading(spoken))) == .spoken(host: "Cass", label: "Top of the hour"))
        #expect(widgetReading(state(reading(spoken, host: nil))) == .spoken(host: nil, label: "Top of the hour"))
    }

    @Test func sendsTheListenerToTheAppBeforeAnyStationIsKept() {
        #expect(widgetReading(state(reading(record), hasStation: false)) == .noStation)
    }

    @Test func restsUntilTheAppHasHeardAnything() {
        #expect(widgetReading(state(nil, playback: .stopped)) == .resting)
    }

    @Test func nothingOnWhileAskingIsWarmingUpAndWhileNotIsOffAir() {
        #expect(widgetReading(state(reading(nil, onAir: false), playback: .warmingUp)) == .warmingUp)
        #expect(widgetReading(state(reading(nil, onAir: false), playback: .stopped)) == .offAir)
        // Asked for and not heard yet: the seconds after a press.
        #expect(widgetReading(state(nil, playback: .warmingUp)) == .warmingUp)
    }

    @Test func aStationThatStoppedAnsweringSaysSoOverTheLastRecord() {
        #expect(widgetReading(state(reading(record), reachable: false)) == .unreachable)
    }

    @Test func stoppedItShowsWhatWasLastHeard() {
        #expect(widgetReading(state(reading(record), playback: .stopped)) == .record(title: "Windowlicker", artist: "Aphex Twin"))
    }

    @Test func admitsItsAgeOnlyWhenStoppedAndTwoMinutesOld() {
        let stopped = state(reading(record), playback: .stopped)

        #expect(widgetAsOf(stopped, now: at.addingTimeInterval(119)) == nil)
        #expect(widgetAsOf(stopped, now: at.addingTimeInterval(120)) == at)
        #expect(widgetAsOf(state(reading(record)), now: at.addingTimeInterval(600)) == nil)
    }

    @Test func redrawsItselfOnceWhenTheAgeStartsToShow() {
        let stopped = state(reading(record), playback: .stopped)

        #expect(widgetRedrawAt(stopped, now: at) == at.addingTimeInterval(120))
        #expect(widgetRedrawAt(stopped, now: at.addingTimeInterval(120)) == nil)
        #expect(widgetRedrawAt(state(reading(record)), now: at) == nil)
    }

    @Test func aPressIsWorthDrawingThoughTheReadingStoodStill() {
        let playing = state(reading(record))
        var stopped = playing
        stopped.playback = .stopped

        #expect(worthDrawing(playing, stopped))
        #expect(!worthDrawing(playing, playing))
    }

    @Test func beforeTheFirstAnswerTheLastSnapshotStands() {
        let last = state(reading(record)).snapshot

        #expect(advance(last, heard: .loading, station: station(), stationName: "Static", now: at.addingTimeInterval(30)) == last)
    }

    @Test func aFailedPollMarksTheLastGoodFieldsAndKeepsTheirAge() {
        let last = state(reading(record)).snapshot

        let next = advance(last, heard: .unreachable(lastGood: nil), station: station(), stationName: "Static", now: at.addingTimeInterval(30))

        #expect(!next.reachable)
        #expect(next.title == "Windowlicker")
        #expect(next.readAt == at)
    }

    @Test func anAnswerIsANewSnapshotStampedNow() {
        let later = at.addingTimeInterval(30)

        let next = advance(WidgetSnapshot(), heard: .answered(Reading(reading(spoken), readAt: .now)), station: station(), stationName: "Static", now: later)

        #expect(next.kind == .break)
        #expect(next.readAt == later)
        #expect(next.reachable)
    }

    @Test func theStoreRoundTripsTheStateAndTheCover() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "widget-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = WidgetStore(directory: directory)
        #expect(store.read() == nil)

        let written = state(reading(record))
        try store.write(written)
        try store.writeCover(Data([1, 2, 3]))

        #expect(store.read() == written)
        #expect(try Data(contentsOf: store.coverFile) == Data([1, 2, 3]))
        store.removeCover()
        #expect(!FileManager.default.fileExists(atPath: store.coverFile.path()))
    }

    @Test func aFileThisBuildCannotReadIsNoState() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: "widget-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = WidgetStore(directory: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("not json".utf8).write(to: store.stateFile)

        #expect(store.read() == nil)
    }
}
