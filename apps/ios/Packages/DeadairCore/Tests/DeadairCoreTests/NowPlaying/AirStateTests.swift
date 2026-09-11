@testable import DeadairCore
import DeadairSdk
import Testing

/// Telling warming up from off air.
///
/// The station answers `onAir: false` for both, so the answer alone cannot separate them. What does
/// is whether this listener is currently asking for audio, which matters because under
/// `playout.airMode: audience` the asking is what puts the station on air in the first place.
struct AirStateTests {
    private let track = NowPlayingTrack(title: "Windowlicker", artist: "Aphex Twin", startedAt: 1)

    private func answered(onAir: Bool, track: NowPlayingTrack? = nil) -> NowPlayingState {
        .answered(Reading(NowPlaying(station: "S", onAir: onAir, listeners: 0, mounts: [], track: track), readAt: .now))
    }

    @Test func namesTheRecordWhenOneIsPlaying() {
        #expect(airState(answered(onAir: true, track: track), playbackRequested: true) == .onAir(track))
    }

    @Test func isOffAirWhenTheStationIsQuietAndNobodyAskedForAudio() {
        #expect(airState(answered(onAir: false), playbackRequested: false) == .offAir)
    }

    @Test func isWarmingUpWhenAudioWasAskedForAndNothingIsThroughYet() {
        // The seconds after pressing play on an audience-gated station. Ordinary, and not an error.
        #expect(airState(answered(onAir: false), playbackRequested: true) == .warmingUp)
    }

    @Test func isWarmingUpBeforeTheFirstAnswerArrivesNotOffAir() {
        #expect(airState(.loading, playbackRequested: true) == .warmingUp)
        #expect(airState(.loading, playbackRequested: false) == .offAir)
    }

    @Test func doesNotClaimARecordForAnOnAirAnswerThatNamesNone() {
        // A shape the contract says will not occur. Believing it would mean showing a record that
        // is not there, so it degrades to the honest state instead.
        #expect(airState(answered(onAir: true, track: nil), playbackRequested: true) == .warmingUp)
    }

    @Test func saysTheStationIsUnreachableHoweverGoodTheLastReadingWas() {
        let lastGood = Reading(NowPlaying(station: "S", onAir: true, listeners: 3, mounts: [], track: track), readAt: .now)

        #expect(airState(.unreachable(lastGood: lastGood), playbackRequested: true) == .unreachable)
    }
}
