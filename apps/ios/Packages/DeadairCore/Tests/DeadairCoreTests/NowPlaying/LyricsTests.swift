@testable import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// The lyrics sheet's arithmetic and its one refusal. `apps/android`'s `LyricsTest`, case for case.
struct LyricsTests {
    private let track = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
    private let started = 1_790_000_000_000
    private let lines = [
        LyricLineDetail(atMs: 10_000, text: "First line"),
        LyricLineDetail(atMs: 14_000, text: "Second line"),
        LyricLineDetail(atMs: 18_000, text: ""),
        LyricLineDetail(atMs: 25_000, text: "After the gap"),
    ]

    private func answer(
        kind: TrackLyricsKind = .words, synced: [LyricLineDetail]?? = nil, plain: String? = nil, cueOutMs: Int? = nil, startedAt: Int? = nil
    ) -> NowPlayingLyrics {
        NowPlayingLyrics(
            onAir: true,
            trackId: track,
            startedAt: startedAt ?? started,
            cueOutMs: cueOutMs,
            lyrics: TrackLyrics(trackId: track, kind: kind, provider: "deadair.lrclib", plain: plain, synced: synced ?? lines)
        )
    }

    /// A playhead `elapsed` into a record of `duration`, as `Playhead.project` builds one.
    private func at(_ elapsed: Int, duration: Int = 240_000) -> Playhead {
        Playhead(elapsedMs: elapsed, remainingMs: duration - elapsed, durationMs: duration)
    }

    @Test func anUnmeasuredRecordsPositionIsItsLengthMinusWhatRemains() {
        #expect(lyricPositionMs(at(15_000), cueOutMs: nil) == 15_000)
    }

    @Test func aMeasuredRecordsPositionCountsBackFromTheCueOutNotTheFilesLength() {
        // Three seconds of tail trimmed: 200s left of a 240s file is 37s in, not 40s.
        let playhead = Playhead(elapsedMs: 40_000, remainingMs: 200_000, durationMs: 240_000)
        #expect(lyricPositionMs(playhead, cueOutMs: 237_000) == 37_000)
    }

    @Test func theCurrentLineIsTheLastOneThatHasStarted() {
        #expect(currentLine(lines, positionMs: 9_999) == nil)
        #expect(currentLine(lines, positionMs: 10_000) == 0)
        #expect(currentLine(lines, positionMs: 17_999) == 1)
        #expect(currentLine(lines, positionMs: 300_000) == 3)
    }

    @Test func aBlankLineIsAGapAndLightsNothing() {
        #expect(currentLine(lines, positionMs: 20_000) == nil)
    }

    @Test func timedLinesAreLitFromTheHeardPlayhead() {
        #expect(LyricsUiState(answer: answer(), heardStartedAt: started, playhead: at(15_000)) == .synced(lines: lines, current: 1, provider: "deadair.lrclib"))
    }

    @Test func aDecoderThatCannotSayWhereItIsShowsTheLinesUnlit() {
        #expect(LyricsUiState(answer: answer(), heardStartedAt: started, playhead: nil) == .synced(lines: lines, current: nil, provider: "deadair.lrclib"))
    }

    @Test func lyricsForAnotherAiringAreNotShownAtAll() {
        // The station names the next record while this listener still hears the last one.
        #expect(LyricsUiState(answer: answer(startedAt: started + 240_000), heardStartedAt: started, playhead: at(230_000)) == .hidden)
        #expect(LyricsUiState(answer: answer(), heardStartedAt: nil, playhead: nil) == .hidden)
    }

    @Test func plainWordsShowWhenThereAreNoTimings() {
        #expect(LyricsUiState(answer: answer(synced: .some(nil), plain: "Words only"), heardStartedAt: started, playhead: at(1_000)) == .plain(text: "Words only", provider: "deadair.lrclib"))
    }

    @Test func nothingToShowDrawsNoButton() {
        #expect(LyricsUiState(answer: nil, heardStartedAt: started, playhead: at(1_000)) == .hidden)
        #expect(LyricsUiState(answer: answer(kind: .none, synced: .some(nil)), heardStartedAt: started, playhead: at(1_000)) == .hidden)
        #expect(LyricsUiState(answer: answer(kind: .instrumental, synced: .some(nil)), heardStartedAt: started, playhead: at(1_000)) == .hidden)
        #expect(LyricsUiState(answer: answer(synced: .some([]), plain: " "), heardStartedAt: started, playhead: at(1_000)) == .hidden)
    }
}
