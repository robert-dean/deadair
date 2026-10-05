@testable import DeadairCore
import DeadairSdk
import Testing

/// What the car's one row says, and when it stops being equal to what the car already shows.
struct CarStationTests {
    private let record = NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", artworkUrl: "art/cover-1", startedAt: 1)
    private let spoken = NowPlayingTrack(kind: .break, title: "Top of the hour", artist: "", startedAt: 2)

    private func reading(_ track: NowPlayingTrack?, listeners: Int = 1, onAir: Bool = true) -> NowPlaying {
        NowPlaying(station: "Static", onAir: onAir, listeners: listeners, mounts: [], show: NowPlayingShow(name: "Late Static", host: "Cass", hostArtUrl: "art/portrait-1/cover.png"), track: track)
    }

    private func item(_ reading: NowPlaying?, playing: Bool = true, kept: Bool = true) -> CarStationItem {
        carStationItem(station: kept ? station() : nil, name: "Static", reading: reading, playing: playing)
    }

    @Test func namesTheStationAndTheRecordOnAirWithItsCover() {
        let row = item(reading(record))

        #expect(row == CarStationItem(name: "Static", lines: [.text("Windowlicker"), .text("Aphex Twin")], artworkUrl: station().artUrl("art/cover-1"), playing: true, canPlay: true))
    }

    @Test func showsThePresentersPortraitAndWhoIsTalkingDuringABreak() {
        let row = item(reading(spoken))

        #expect(row.lines == [.onTheMic(host: "Cass"), .text("Top of the hour")])
        #expect(row.artworkUrl == station().artUrl("art/portrait-1/cover.png"))
    }

    @Test func saysOffAirWhenTunedInAndNothingIsOnAir() {
        #expect(item(reading(nil, onAir: false)).lines == [.offAir])
        #expect(item(nil).lines == [.offAir])
        #expect(item(nil).artworkUrl == nil)
    }

    @Test func claimsNothingAboutWhatIsOnWhileTheListenerIsNotTunedIn() {
        let row = item(reading(record), playing: false)

        #expect(row == CarStationItem(name: "Static", lines: [], artworkUrl: nil, playing: false, canPlay: true))
    }

    @Test func sendsTheListenerToThePhoneBeforeAnyStationIsKept() {
        let row = item(reading(record), playing: true, kept: false)

        #expect(row.lines == [.chooseStationOnPhone])
        #expect(!row.canPlay)
        #expect(!row.playing)
    }

    @Test func fallsBackToTheAppsNameWhenTheStationNamedNothing() {
        #expect(carStationItem(station: station(), name: "  ", reading: nil, playing: false).name == "deadair")
        #expect(carStationItem(station: station(), name: nil, reading: nil, playing: false).name == "deadair")
    }

    @Test func staysEqualWhenOnlyTheListenerCountMoves() {
        #expect(item(reading(record, listeners: 1)) == item(reading(record, listeners: 9)))
    }

    @Test func changesWhenTheRecordOrTheSpeakerDoes() {
        let next = NowPlayingTrack(title: "Xtal", artist: "Aphex Twin", artworkUrl: "art/cover-2", startedAt: 3)

        #expect(item(reading(record)) != item(reading(next)))
        #expect(item(reading(record)) != item(reading(spoken)))
        #expect(item(reading(record)) != item(reading(record), playing: false))
    }
}
