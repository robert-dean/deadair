@testable import DeadairCore
import DeadairSdk
import Testing

/// Which mount gets played, and which formats the picker offers.
///
/// The paths come from the station rather than being derived here, which is the point: deriving
/// `/live.opus` from `/live.mp3` works until an operator renames the mount, and then fails in a way
/// that looks like the stream being down rather than like a wrong guess.
struct MountSelectionTests {
    private let published = [
        NowPlayingMount(format: .mp3, path: "/live.mp3", bitrateKbps: 128),
        NowPlayingMount(format: .aac, path: "/live.aac", bitrateKbps: 192),
        NowPlayingMount(format: .hls, path: "/live.m3u8"),
    ]

    @Test func playsTheFormatTheListenerChoseWhenTheStationPublishesIt() {
        #expect(chooseMount(published, wanted: .aac) == MountChoice(path: "/live.aac", format: .aac, fellBack: false))
    }

    @Test func fallsBackToMp3ForAFormatTheOperatorHasNotSwitchedOnAndSaysSo() {
        #expect(chooseMount(published, wanted: .flac) == MountChoice(path: "/live.mp3", format: .mp3, fellBack: true))
    }

    @Test func followsARenamedMountRatherThanDerivingOne() {
        let renamed = [NowPlayingMount(format: .mp3, path: "/wireless.mp3"), NowPlayingMount(format: .opus, path: "/wireless.opus")]

        #expect(chooseMount(renamed, wanted: .opus).path == "/wireless.opus")
        #expect(chooseMount(renamed, wanted: .flac).path == "/wireless.mp3")
    }

    @Test func guessesTheDefaultMountBeforeTheStationHasAnswered() {
        #expect(chooseMount([], wanted: .mp3) == MountChoice(path: "/live.mp3", format: .mp3, fellBack: false))
    }

    @Test func marksTheGuessAsAFallbackWhenItIsNotTheChosenFormat() {
        #expect(chooseMount([], wanted: .hls) == MountChoice(path: "/live.mp3", format: .mp3, fellBack: true))
    }

    @Test func playsSomethingRatherThanNothingIfAStationEverOmitsMp3() {
        let choice = chooseMount([NowPlayingMount(format: .flac, path: "/only.flac")], wanted: .aac)

        #expect(choice == MountChoice(path: "/only.flac", format: .flac, fellBack: true))
    }

    @Test func offersWhatTheStationPublishesAndGreysWhatItDoesNot() {
        let available = availableFormats([NowPlayingMount(format: .mp3, path: "/live"), NowPlayingMount(format: .hls, path: "/live")])

        #expect(available == [.mp3: true, .hls: true, .opus: false, .flac: false, .aac: false])
    }

    @Test func offersEveryFormatBeforeTheStationHasSaidAnything() {
        // No reading yet. Greying on no evidence would be a guess presented as fact.
        #expect(availableFormats(nil).isEmpty)
    }

    @Test func mapsEveryFormatToTheWireAndBack() {
        for format in StreamFormat.allCases {
            #expect(StreamFormat(wire: format.wire) == format)
        }
    }
}
