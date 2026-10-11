@testable import DeadairCore
import DeadairSdk
import Testing

/// What the lock screen's bar is told, and when.
///
/// The rules worth pinning: the bar follows the reading the listener is HEARING, it is a record's
/// and never a break's, and a new record or a stop is published rather than left for the system's
/// own extrapolation to get wrong. Android's `SessionProgressTest`, case for case where they share one.
struct LockScreenProgressTests {
    private let origin = ContinuousClock.now

    private func at(_ ms: Int) -> ContinuousClock.Instant { origin.advanced(by: .milliseconds(ms)) }

    private func heard(kind: NowPlayingTrackKind = .record, durationMs: Int? = 240_000, remainingMs: Int? = 60_000, readAt: Int = 10_000) -> Reading<NowPlaying> {
        let track = NowPlayingTrack(kind: kind, title: "t", artist: "a", durationMs: durationMs, startedAt: 1_700_000_000_000, remainingMs: remainingMs)
        return Reading(NowPlaying(station: "deadair", onAir: true, listeners: 1, mounts: [], track: track), readAt: at(readAt))
    }

    @Test func aRecordWithALengthHasABarProjectedFromTheHeardReading() {
        #expect(LockScreenProgress.of(heard(), now: at(15_000)) == LockScreenProgress(elapsedMs: 185_000, durationMs: 240_000))
    }

    @Test func aReadingStampedForTheEarsAheadOfNowLeavesMoreToCome() {
        #expect(LockScreenProgress.of(heard(readAt: 20_000), now: at(12_000))?.elapsedMs == 172_000)
    }

    @Test func aBreakHasNoBarEvenWithALength() {
        #expect(LockScreenProgress.of(heard(kind: .break), now: at(10_000)) == nil)
    }

    @Test func aProgrammeWithNoLengthOrNoCountdownHasNoBar() {
        #expect(LockScreenProgress.of(heard(durationMs: nil), now: at(10_000)) == nil)
        #expect(LockScreenProgress.of(heard(remainingMs: nil), now: at(10_000)) == nil)
    }

    @Test func nothingHeardOrOffAirHasNoBar() {
        #expect(LockScreenProgress.of(nil, now: at(10_000)) == nil)
        let offAir = Reading(NowPlaying(station: "deadair", onAir: false, listeners: 0, mounts: []), readAt: at(10_000))
        #expect(LockScreenProgress.of(offAir, now: at(10_000)) == nil)
    }

    @Test func theFirstAnswerIsAlwaysPublishedEvenWhenItIsNoBar() {
        #expect(LockScreenProgressState().needsUpdate(to: nil, playing: false, now: at(0)))
    }

    @Test func theSystemsBarRunsOnWhilePlayingAndStandsStillWhileNot() {
        var state = LockScreenProgressState()
        state.record(LockScreenProgress(elapsedMs: 100_000, durationMs: 240_000), playing: true, at: at(0))
        #expect(state.extrapolated(now: at(5_000))?.elapsedMs == 105_000)
        #expect(state.extrapolated(now: at(500_000))?.elapsedMs == 240_000)

        state.record(LockScreenProgress(elapsedMs: 100_000, durationMs: 240_000), playing: false, at: at(0))
        #expect(state.extrapolated(now: at(5_000))?.elapsedMs == 100_000)
    }

    @Test func aPollReanchoringTheSameRecordIsLeftToTheSystem() {
        var state = LockScreenProgressState()
        state.record(LockScreenProgress(elapsedMs: 100_000, durationMs: 240_000), playing: true, at: at(0))
        #expect(!state.needsUpdate(to: LockScreenProgress(elapsedMs: 103_400, durationMs: 240_000), playing: true, now: at(3_000)))
        #expect(!state.needsUpdate(to: LockScreenProgress(elapsedMs: 102_200, durationMs: 240_000), playing: true, now: at(3_000)))
    }

    @Test func aNewRecordABarComingOrGoingOrARealJumpIsPublished() {
        var state = LockScreenProgressState()
        state.record(LockScreenProgress(elapsedMs: 238_000, durationMs: 240_000), playing: true, at: at(0))
        #expect(state.needsUpdate(to: LockScreenProgress(elapsedMs: 1_000, durationMs: 200_000), playing: true, now: at(1_000)))
        #expect(state.needsUpdate(to: nil, playing: true, now: at(1_000)))
        // The same length twice running is still a different record when the position says so.
        #expect(state.needsUpdate(to: LockScreenProgress(elapsedMs: 2_000, durationMs: 240_000), playing: true, now: at(1_000)))

        state.record(nil, playing: true, at: at(0))
        #expect(state.needsUpdate(to: LockScreenProgress(elapsedMs: 1_000, durationMs: 200_000), playing: true, now: at(1_000)))
        #expect(!state.needsUpdate(to: nil, playing: true, now: at(1_000)))
    }

    @Test func aStopOrAResumeIsPublishedSoTheRateFollowsIt() {
        var state = LockScreenProgressState()
        let progress = LockScreenProgress(elapsedMs: 100_000, durationMs: 240_000)
        state.record(progress, playing: false, at: at(0))
        #expect(state.needsUpdate(to: progress, playing: true, now: at(0)))

        state.record(progress, playing: true, at: at(0))
        #expect(state.needsUpdate(to: LockScreenProgress(elapsedMs: 100_000, durationMs: 240_000), playing: false, now: at(0)))
    }

    @Test func aResetPublishesWhateverComesNext() {
        var state = LockScreenProgressState()
        state.record(nil, playing: true, at: at(0))
        state.reset()
        #expect(state.needsUpdate(to: nil, playing: true, now: at(0)))
    }
}
