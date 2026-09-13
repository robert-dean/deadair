@testable import DeadairCore
import DeadairSdk
import Testing

/// What the lock screen, Control Center and a car read.
///
/// The failure this exists for is a break arriving with an empty artist, and the tile showing a
/// title over nothing. The same cases as `apps/android`'s `LockScreenTextTest`.
struct LockScreenLinesTests {
    private func reading(_ track: NowPlayingTrack?, show: NowPlayingShow? = nil) -> NowPlaying {
        NowPlaying(station: "Static", onAir: track != nil, listeners: 1, mounts: [], show: show, track: track)
    }

    @Test func namesTheRecordAndItsArtistWithItsAlbum() {
        let lines = lockScreenLines(station: "Static", reading: reading(NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", album: "Windowlicker", startedAt: 1)))

        #expect(lines == LockScreenLines(title: .text("Windowlicker"), artist: .text("Aphex Twin"), album: "Windowlicker"))
    }

    @Test func putsTheStationWhereTheAlbumGoesWhenTheRecordHasNone() {
        let lines = lockScreenLines(station: "Static", reading: reading(NowPlayingTrack(title: "Untitled", artist: "Someone", startedAt: 1)))

        #expect(lines.album == "Static")
    }

    @Test func namesTheHostRatherThanAnEmptyArtistDuringABreak() {
        let spoken = NowPlayingTrack(kind: .break, title: "Top of the hour", artist: "", startedAt: 1)

        let lines = lockScreenLines(station: "Static", reading: reading(spoken, show: NowPlayingShow(name: "Late Static", host: "Cass")))

        #expect(lines == LockScreenLines(title: .onTheMic(host: "Cass"), artist: .text("Top of the hour"), album: "Late Static"))
    }

    @Test func saysSomebodyIsTalkingDuringABreakThatNamesNobody() {
        let spoken = NowPlayingTrack(kind: .break, title: "Ident", artist: "", startedAt: 1)

        #expect(lockScreenLines(station: "Static", reading: reading(spoken)) == LockScreenLines(title: .onTheMic(host: nil), artist: .text("Ident"), album: "Static"))
    }

    @Test func saysOffAirUnderTheStationsName() {
        #expect(lockScreenLines(station: "Static", reading: reading(nil)) == LockScreenLines(title: .text("Static"), artist: .offAir, album: nil))
        #expect(lockScreenLines(station: "Static", reading: nil) == LockScreenLines(title: .text("Static"), artist: .offAir, album: nil))
    }
}
