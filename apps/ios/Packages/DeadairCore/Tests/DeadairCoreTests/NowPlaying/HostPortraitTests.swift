@testable import DeadairCore
import DeadairSdk
import Testing

/// Whose picture goes where: beside the presenter's name, and in the cover's place during a break.
struct HostPortraitTests {
    private let record = NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", artworkUrl: "art/cover-1", startedAt: 1)
    private let spoken = NowPlayingTrack(kind: .break, title: "Top of the hour", artist: "", startedAt: 2)

    private func reading(_ track: NowPlayingTrack?, host: String? = "Cass", art: String? = "art/portrait-1/cover.png", onAir: Bool = true) -> NowPlaying {
        NowPlaying(station: "Static", onAir: onAir, listeners: 1, mounts: [], show: NowPlayingShow(name: "Late Static", host: host, hostArtUrl: art), track: track)
    }

    @Test func resolvesTheRelativePortraitUnderTheApiRootAsACoverIs() {
        #expect(hostPortraitUrl(station: station(), reading: reading(record)) == "https://radio.example.com/api/art/portrait-1/cover.png")
        #expect(hostPortraitUrl(station: station(), reading: reading(record, art: "/art/p")) == station().artUrl("/art/p"))
    }

    @Test func keepsAnAbsolutePortraitAsItIs() {
        #expect(hostPortraitUrl(station: station(), reading: reading(record, art: "https://cdn.example.com/p.png")) == "https://cdn.example.com/p.png")
    }

    @Test func hasNoPortraitForAPresenterWithoutOneOrAnOlderStation() {
        #expect(hostPortraitUrl(station: station(), reading: reading(record, art: nil)) == nil)
        #expect(hostPortraitUrl(station: station(), reading: reading(record, art: "  ")) == nil)
        let older = NowPlaying(station: "Static", onAir: true, listeners: 1, mounts: [], show: NowPlayingShow(name: "Late Static", host: "Cass"), track: record)
        #expect(hostPortraitUrl(station: station(), reading: older) == nil)
    }

    @Test func hasNoPortraitOffAirOrWithoutAStation() {
        #expect(hostPortraitUrl(station: station(), reading: reading(nil, onAir: false)) == nil)
        #expect(hostPortraitUrl(station: station(), reading: nil) == nil)
        #expect(hostPortraitUrl(station: nil, reading: reading(record)) == nil)
    }

    @Test func givesThePortraitBesideANameOnlyWhenTheReadingNamesTheSamePerson() {
        #expect(hostPortraitUrl(station: station(), reading: reading(record), naming: "Cass") != nil)
        // Recast in the order, and the poll still describing the presenter before.
        #expect(hostPortraitUrl(station: station(), reading: reading(record), naming: "Ray") == nil)
        #expect(hostPortraitUrl(station: station(), reading: reading(record, host: nil), naming: "Cass") == nil)
    }

    @Test func aRecordKeepsItsOwnCoverWhateverThePresenterLooksLike() {
        #expect(coverArtUrl(station: station(), reading: reading(record)) == "https://radio.example.com/api/art/cover-1")
    }

    @Test func aBreakShowsWhoIsTalking() {
        #expect(coverArtUrl(station: station(), reading: reading(spoken)) == "https://radio.example.com/api/art/portrait-1/cover.png")
    }

    @Test func aBreakWithoutAPortraitIsAsItWasBefore() {
        #expect(coverArtUrl(station: station(), reading: reading(spoken, art: nil)) == nil)
        let pictured = NowPlayingTrack(kind: .break, title: "Ident", artist: "", artworkUrl: "art/break-1", startedAt: 3)
        #expect(coverArtUrl(station: station(), reading: reading(pictured, art: nil)) == "https://radio.example.com/api/art/break-1")
    }

    @Test func showsNothingOffAir() {
        #expect(coverArtUrl(station: station(), reading: reading(record, onAir: false)) == nil)
        #expect(coverArtUrl(station: station(), reading: nil) == nil)
    }
}
