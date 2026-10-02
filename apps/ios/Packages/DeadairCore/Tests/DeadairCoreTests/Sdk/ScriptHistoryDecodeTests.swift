import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// That the generated SDK decodes what a real station says it said.
///
/// The fixture is the live station's `GET /scripts` from 2026-10-02, three attempts of six: a
/// model's words, a model's decline, and the floor's words, with the prompt and the raw reply
/// dropped (the phone never shows either) and long text cut short.
struct ScriptHistoryDecodeTests {
    @Test func decodesTheLiveHistoryAndReadsEachOutcome() throws {
        let page = try SdkJSON.makeDecoder().decode(ScriptHistoryPage.self, from: Data(Self.live.utf8))
        #expect(page.attempts.count == 3)
        #expect(page.nextBefore != nil)
        #expect(page.attempts.map { ScriptRowUiState($0).tone } == [.ok, .standby, .ok])
        #expect(page.attempts.map(\.writer) == ["model", "model", "deterministic"])
        #expect(ScriptRowUiState(page.attempts[1]).lineIsReason)
    }

    static let live = #"""
            {
              "attempts": [
                {
                  "id": "54f1c70a-3d72-4f50-a1d3-f1aaf6acaf14",
                  "at": "2026-10-02T16:31:10.662Z",
                  "kind": "talkbreak",
                  "writer": "model",
                  "outcome": "written",
                  "personaKey": "videoage",
                  "label": "Talk break: One Bourbon, One Scotch, One Beer into Shot in the Dark",
                  "script": "Oh my god, just dropping that George Thorogood record, like, one Bourbon, One Scotch, One Beer? It was so jazzy to the max, right? I mean, no way is this next t",
                  "model": "ollama:gemma4:latest",
                  "segmentId": "110a2b5b-3d74-4118-97dd-057f858ef863",
                  "previous": {
                    "title": "One Bourbon, One Scotch, One Beer",
                    "artist": "George Thorogood & The Destroyers",
                    "facts": [
                      "It was released in 1977 by the label Rounder Records."
                    ]
                  },
                  "next": {
                    "title": "Shot in the Dark",
                    "artist": "Ozzy Osbourne",
                    "facts": [
                      "\"Shot in the Dark\" is a song recorded and performed by Engli"
                    ]
                  },
                  "durationMs": 12482,
                  "usage": {
                    "inputTokens": 6582,
                    "outputTokens": 1494,
                    "totalTokens": 8076
                  }
                },
                {
                  "id": "21a31826-73fa-4e02-bf77-9bde3fa034f1",
                  "at": "2026-10-02T16:31:10.652Z",
                  "kind": "talkbreak",
                  "writer": "model",
                  "outcome": "declined",
                  "personaKey": "videoage",
                  "model": "ollama:gemma4:latest",
                  "reason": "the model wrote a line the station could say, but not in its own voice",
                  "segmentId": "110a2b5b-3d74-4118-97dd-057f858ef863",
                  "previous": {
                    "title": "One Bourbon, One Scotch, One Beer",
                    "artist": "George Thorogood & The Destroyers",
                    "facts": [
                      "It was released in 1977 by the label Rounder Records."
                    ]
                  },
                  "next": {
                    "title": "Shot in the Dark",
                    "artist": "Ozzy Osbourne",
                    "facts": [
                      "\"Shot in the Dark\" is a song recorded and performed by Engli"
                    ]
                  },
                  "durationMs": 16564,
                  "usage": {
                    "inputTokens": 6418,
                    "outputTokens": 1600,
                    "totalTokens": 8018
                  }
                },
                {
                  "id": "ec402d78-4bf5-4a6e-be1c-43d2ffab3768",
                  "at": "2026-10-02T16:17:26.831Z",
                  "kind": "jingle",
                  "writer": "deterministic",
                  "outcome": "written",
                  "personaKey": "videoage",
                  "label": "Jingle",
                  "script": "Tiffani on Deadair. Here's another one.",
                  "source": "[[{{dj.name}} on ]]{{station.name}}. Here's another one.",
                  "segmentId": "8da36a68-484c-4055-970e-3cd15aedd53a",
                  "previous": {
                    "title": "Mary Jane's Last Dance",
                    "artist": "Tom Petty and the Heartbreakers",
                    "facts": [
                      "Anthology: Through the Years is a double compilation album f"
                    ]
                  },
                  "next": {
                    "title": "Only the Good Die Young",
                    "artist": "Billy Joel",
                    "facts": [
                      "\"Only the Good Die Young\" is a song written and recorded by "
                    ]
                  },
                  "durationMs": 2
                }
              ],
              "nextBefore": "2026-10-02T16:13:36.296Z|d747877f-8048-4004-a560-36c2bafcf23f"
            }
        """#
}
