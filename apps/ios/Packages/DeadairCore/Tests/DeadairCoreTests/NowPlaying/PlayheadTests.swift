@testable import DeadairCore
import DeadairSdk
import Testing

/// The projected playhead.
///
/// The rule worth defending is the one about NOT projecting: a clock extrapolated from a start time
/// would keep moving confidently while being wrong, and the transport is not allowed to be a
/// moving, confident lie.
struct PlayheadTests {
    private let origin = ContinuousClock.now

    private func at(_ ms: Int) -> ContinuousClock.Instant { origin.advanced(by: .milliseconds(ms)) }

    private func track(durationMs: Int? = 300_000, remainingMs: Int? = 120_000) -> NowPlayingTrack {
        NowPlayingTrack(title: "t", artist: "a", durationMs: durationMs, startedAt: 1_700_000_000_000, remainingMs: remainingMs)
    }

    @Test func hasNothingToShowWithoutATrack() {
        #expect(Playhead.project(nil, readAt: at(0), now: at(0)) == nil)
    }

    @Test func hasNothingToShowWhenTheDecoderCouldNotSayHowLongTheRecordIs() {
        #expect(Playhead.project(track(durationMs: nil), readAt: at(0), now: at(1_000)) == nil)
    }

    @Test func refusesToExtrapolateFromTheStartTimeAlone() {
        // `startedAt` is present and `remainingMs` is not. Everything needed for a plausible
        // clock is here, and the answer is still nothing, which is the whole point.
        #expect(Playhead.project(track(remainingMs: nil), readAt: at(0), now: at(1_000)) == nil)
    }

    @Test func carriesTheClockForwardBetweenReadings() throws {
        let head = try #require(Playhead.project(track(), readAt: at(1_000), now: at(3_500)))

        // 2.5s past the reading, so 117.5s left of a 300s record.
        #expect(head == Playhead(elapsedMs: 182_500, remainingMs: 117_500, durationMs: 300_000))
    }

    @Test func reanchorsOnAFreshReadingRatherThanDrifting() throws {
        let carried = try #require(Playhead.project(track(remainingMs: 100_000), readAt: at(0), now: at(9_000)))
        // The station's next answer says something different. It wins outright.
        let anchored = try #require(Playhead.project(track(remainingMs: 120_000), readAt: at(9_000), now: at(9_000)))

        #expect(carried.remainingMs == 91_000)
        #expect(anchored.remainingMs == 120_000)
    }

    @Test func stopsAtTheEndOfTheRecordRatherThanRunningPastIt() throws {
        // The next reading is late, a slow poll or a backed-off one, and a clock that ran
        // negative would show a progress bar past its own end.
        let head = try #require(Playhead.project(track(remainingMs: 2_000), readAt: at(0), now: at(60_000)))

        #expect(head.remainingMs == 0)
        #expect(head.elapsedMs == 300_000)
        #expect(head.fraction == 1)
    }

    @Test func neverReportsMoreLeftThanTheRecordIsLong() throws {
        // A reading taken after "now", which only a clock running backwards could produce.
        let head = try #require(Playhead.project(track(remainingMs: 400_000), readAt: at(5_000), now: at(0)))

        #expect(head.remainingMs == 300_000)
        #expect(head.elapsedMs == 0)
    }

    @Test func hasNothingToShowForARecordOfNoLength() {
        #expect(Playhead.project(track(durationMs: 0), readAt: at(0), now: at(0)) == nil)
    }

    @Test func writesALengthTheWayAClockReadsIt() {
        #expect(clockOf(0) == "0:00")
        #expect(clockOf(7_400) == "0:07")
        #expect(clockOf(238_000) == "3:58")
        #expect(clockOf(600_000) == "10:00")
        // Past an hour the hours appear and the minutes gain their zero.
        #expect(clockOf(3_730_000) == "1:02:10")
        // A negative can only come from a clock that ran backwards, and reads as the start.
        #expect(clockOf(-5_000) == "0:00")
    }
}
