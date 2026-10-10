import DeadairSdk
import Foundation
import Testing

/// That the generated SDK decodes what `/nowplaying/lyrics` answers. The fixtures are the shapes
/// `LyricsReadService.getNowPlayingLyrics` produces, one per branch it has.
struct NowPlayingLyricsDecodeTests {
    private func decode(_ json: String) throws -> NowPlayingLyrics {
        try SdkJSON.makeDecoder().decode(NowPlayingLyrics.self, from: Data(json.utf8))
    }

    @Test func decodesAMeasuredRecordWithTimedLines() throws {
        let answer = try decode("""
        {
          "onAir": true,
          "trackId": "33333333-3333-4333-8333-333333333333",
          "startedAt": 1790000000000,
          "cueInMs": 1500,
          "cueOutMs": 238001,
          "lyrics": {
            "trackId": "33333333-3333-4333-8333-333333333333",
            "kind": "words",
            "provider": "deadair.lrclib",
            "synced": [ { "atMs": 9000, "text": "first words" }, { "atMs": 12000, "endMs": 14000, "text": "" } ],
            "language": "en"
          }
        }
        """)
        #expect(answer.startedAt == 1_790_000_000_000)
        #expect(answer.cueOutMs == 238_001)
        #expect(answer.lyrics?.kind == .words)
        #expect(answer.lyrics?.synced?.first?.text == "first words")
        #expect(answer.lyrics?.synced?[1].endMs == 14_000)
    }

    @Test func decodesABreakWithNothingButTheAiring() throws {
        let answer = try decode(#"{ "onAir": true, "startedAt": 1790000000000 }"#)
        #expect(answer.trackId == nil)
        #expect(answer.lyrics == nil)
    }

    @Test func decodesOffAir() throws {
        let answer = try decode(#"{ "onAir": false }"#)
        #expect(!answer.onAir)
        #expect(answer.startedAt == nil)
    }

    @Test func decodesARecordNoSourceHasWordsFor() throws {
        let answer = try decode(#"{ "onAir": true, "trackId": "33333333-3333-4333-8333-333333333333", "startedAt": 1, "lyrics": { "trackId": "33333333-3333-4333-8333-333333333333", "kind": "none" } }"#)
        #expect(answer.lyrics?.kind == TrackLyricsKind.none)
    }
}
