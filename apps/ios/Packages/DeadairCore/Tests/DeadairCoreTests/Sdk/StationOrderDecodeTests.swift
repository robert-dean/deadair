import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// That the generated SDK decodes the running order a real station answers, and that the tab reads it
/// the way the console does.
///
/// The fixture is the live station's own `GET /director/air/order` from 2026-10-02, cut from 889 rows
/// to six: an imported playlist, so no persona and no brief, with the skipped break that has never
/// been written, the row on air and its neighbours.
struct StationOrderDecodeTests {
    private func decode() throws -> StationOrder {
        try SdkJSON.makeDecoder().decode(StationOrder.self, from: Data(Self.live.utf8))
    }

    @Test func decodesTheLiveStationsOrder() throws {
        let order = try decode()
        #expect(order.name == "From Spotify")
        #expect(order.source == "import")
        #expect(order.items.count == 6)
        #expect(order.items.first?.kind == .segment)
        #expect(order.items.first?.playable == false)
    }

    @Test func readsTheLiveOrderFromTheRowOnAirAndFoldsWhatCameBefore() throws {
        let ui = RunningOrderUiState(items: try decode().items)
        #expect(ui.anchorIndex == 3)
        #expect(ui.items[3].state == .airing)
        #expect(ui.historyLabel == .foldedHistory(played: 2, passed: 1))
    }

    @Test func anImportedPlaylistNamesNobodySoTheStationsOwnHostPresentsIt() throws {
        let broadcast = BroadcastUiState(order: try decode(), personas: nil)
        #expect(!broadcast.nothingOn)
        #expect(broadcast.brief == nil)
        #expect(broadcast.host == .stationsOwn(nil))
    }

    static let live = #"""
            {
              "name": "From Spotify",
              "mode": "rotation",
              "onEnd": "extend",
              "source": "import",
              "sourcePluginId": "deadair.spotify",
              "sourcePlaylistId": "18CTyTObKdGuc6WJRib5NU",
              "items": [
                {
                  "id": "462bc5eb-e050-48eb-93f2-9579776e702b",
                  "kind": "segment",
                  "state": "skipped",
                  "segmentId": "725fc646-fb32-4987-b570-0212ea9b62e2",
                  "title": "Talk break: Agent Orange into Mr. Crowley - 2002 Version",
                  "artists": [],
                  "segmentState": "planned",
                  "playable": false
                },
                {
                  "id": "cecff20b-e7d4-42a9-9485-023164cd464f",
                  "kind": "track",
                  "state": "played",
                  "pluginId": "deadair.spotify",
                  "externalId": "0c1gHntWjKD7QShC8s99sq",
                  "title": "I Don't Want to Miss a Thing - From the Touchstone film, \"Armageddon\"",
                  "artists": [
                    "Aerosmith"
                  ],
                  "durationMs": 299760,
                  "album": "I Don't Want To Miss A Thing",
                  "artworkUrl": "art/1ad12f15-37bf-4734-9425-703877ce155d/cover.jpg",
                  "year": 1998,
                  "trackId": "7e9ed6f4-f439-45a5-95d1-3cfd1095f201",
                  "rating": "neutral",
                  "artistId": "48515d56-bea4-4cf9-85f4-0ae95b4b72f1",
                  "albumId": "91837057-601a-4d38-b695-765a4a6794de"
                },
                {
                  "id": "b2a45756-7e89-46a4-8131-2b51058a6802",
                  "kind": "segment",
                  "state": "played",
                  "segmentId": "598ebe66-03e2-4da2-8abd-800c025c5ab3",
                  "title": "Talk break: I Don't Want to Miss a Thing - From the Touchstone film, \"Armageddon\" into Song 2 - 2012 Remaster",
                  "artists": [],
                  "segmentState": "ready",
                  "playable": true,
                  "segmentWriter": "model"
                },
                {
                  "id": "71b1f059-4495-46f9-9472-631533961d92",
                  "kind": "track",
                  "state": "airing",
                  "pluginId": "deadair.spotify",
                  "externalId": "1FTSo4v6BOZH9QxKc3MbVM",
                  "title": "Song 2 - 2012 Remaster",
                  "artists": [
                    "Blur"
                  ],
                  "durationMs": 121160,
                  "album": "Blur (Special Edition)",
                  "artworkUrl": "art/bf76a7c5-5478-4f68-bd66-5ed124c224e3/cover.jpg",
                  "year": 1997,
                  "trackId": "144b6807-32a7-4b3d-a749-df3a5a77fc74",
                  "rating": "neutral",
                  "artistId": "60853a7c-3ef0-461f-afd6-490f4b7f96ad",
                  "albumId": "820fcbcf-7347-4c75-b46f-128015405a88",
                  "mixedIn": true
                },
                {
                  "id": "89e027de-7eae-493c-9a0d-1153c4996cc2",
                  "kind": "track",
                  "state": "handed",
                  "pluginId": "deadair.spotify",
                  "externalId": "1L94M3KIu7QluZe63g64rv",
                  "title": "Alive",
                  "artists": [
                    "Pearl Jam"
                  ],
                  "durationMs": 340974,
                  "album": "Ten",
                  "artworkUrl": "art/aa00cb7a-7df5-4739-b627-67f19cd79abf/cover.jpg",
                  "year": 1991,
                  "trackId": "01ff497a-aea1-47ea-b287-e14e07a25b47",
                  "rating": "neutral",
                  "artistId": "869be5f1-84e7-415d-9ad3-dac99b9a6117",
                  "albumId": "a84f39ab-5afd-47c5-98f1-cb32b77e23e0"
                },
                {
                  "id": "1a6594c4-418b-468d-92fe-8134961d40f0",
                  "kind": "segment",
                  "state": "planned",
                  "segmentId": "0912b2d7-41ab-4a9e-a9de-3b34ba89c82c",
                  "title": "Talk break: Alive into Scene Seven: I. The Dance of Eternity",
                  "artists": [],
                  "segmentState": "ready",
                  "playable": true,
                  "segmentWriter": "deterministic"
                }
              ]
            }
        """#
}
