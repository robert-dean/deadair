import DeadairCore
import DeadairSdk
import Foundation
import Testing

/// That the generated SDK decodes a real station's record page and its enrichment, dates and all.
///
/// The fixtures are the live station's `GET /catalog/tracks/{id}` and its `/enrichment` from
/// 2026-10-02, for the record on air, with the long free text cut short and the unmapped `extra`
/// fields dropped (the app never reads them).
struct CatalogDecodeTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try SdkJSON.makeDecoder().decode(type, from: Data(json.utf8))
    }

    @Test func decodesTheLiveRecordPage() throws {
        let track = try decode(TrackDetail.self, Self.track)
        #expect(track.title == "Song 2 - 2012 Remaster")
        #expect(track.playCount == 2)
        #expect(track.plays.count == 2)
    }

    @Test func decodesTheLiveEnrichmentAndLaysItOut() throws {
        let ui = EnrichmentUiState(try decode(TrackEnrichmentDetail.self, Self.enrichment))
        #expect(!ui.isEmpty)
        #expect(ui.sources.count == 4)
        #expect(ui.tags.first == "alternative rock")
    }

    static let track = #"""
            {
              "id": "144b6807-32a7-4b3d-a749-df3a5a77fc74",
              "title": "Song 2 - 2012 Remaster",
              "artistId": "60853a7c-3ef0-461f-afd6-490f4b7f96ad",
              "artistName": "Blur",
              "albumId": "820fcbcf-7347-4c75-b46f-128015405a88",
              "albumName": "Blur (Special Edition)",
              "albumImageUrl": "art/bf76a7c5-5478-4f68-bd66-5ed124c224e3/cover.jpg",
              "artists": "Blur",
              "genre": "alternative rock",
              "year": 1997,
              "durationMs": 121160,
              "rating": "neutral",
              "bindings": [
                {
                  "sourceId": "8c14e26d-74e2-4fc3-87e5-38541942dc81",
                  "pluginId": "deadair.spotify",
                  "externalId": "1FTSo4v6BOZH9QxKc3MbVM",
                  "playable": true,
                  "origin": "discovered",
                  "lastSeenAt": "2026-09-20T18:21:21.096Z",
                  "byteSize": 4765545,
                  "fetchedAt": "2026-09-24T05:11:01.958Z",
                  "lastServedAt": "2026-10-02T16:22:40.365Z",
                  "attempts": 0
                }
              ],
              "analysis": {
                "schemaVersion": 1,
                "complete": true,
                "analyzer": "deadair-analysis/0.1.0",
                "analyzerPluginId": "deadair.analyzer",
                "analyzedAt": "2026-09-24T05:11:07.154Z"
              },
              "plays": [
                {
                  "airedAt": "2026-10-02T16:23:01.769Z",
                  "broadcastId": "97698996-6c27-4393-8b13-ab0d91f4324d",
                  "source": "import"
                },
                {
                  "airedAt": "2026-09-25T21:36:42.361Z",
                  "broadcastId": "a3755034-0c67-4965-95ac-becc5e997206",
                  "source": "import"
                }
              ],
              "playCount": 2
            }
        """#

    static let enrichment = #"""
            {
              "trackId": "144b6807-32a7-4b3d-a749-df3a5a77fc74",
              "merged": {
                "artist": "Blur",
                "title": "Song 2 - 2012 Remaster",
                "album": "Blur (Rough Trade 50th Anniversary Edition)",
                "year": 2026,
                "genres": [
                  "alternative rock",
                  "rock",
                  "britpop",
                  "indie rock",
                  "slacker rock",
                  "Grunge"
                ],
                "facts": [
                  "\"Song 2\" is a song by English rock band Blur. The song is the second song on their eponymous fifth studio album. Release"
                ],
                "isrc": "GBAYE1200348",
                "artworkUrl": "https://coverartarchive.org/release/c5555d72-2713-434d-a26e-584c465a5f99/11267191059-500.jpg",
                "externalIds": [
                  {
                    "source": "musicbrainz",
                    "id": "926a018b-cca9-4ba3-8b35-a8a6c69eb762"
                  },
                  {
                    "source": "musicbrainz-artist",
                    "id": "ba853904-ae25-4ebb-89d6-c44cfbd71bd2"
                  },
                  {
                    "source": "musicbrainz-release",
                    "id": "5b75693a-f19e-401c-a320-bdedd45b6a2e"
                  },
                  {
                    "source": "musicbrainz-release-group",
                    "id": "fdd6c833-3c96-33cb-9917-72e15bcd34bc"
                  },
                  {
                    "source": "musicbrainz",
                    "id": "676c63fe-7c51-4866-92a3-4538e0f90de5"
                  },
                  {
                    "source": "wikidata",
                    "id": "Q85357"
                  }
                ],
                "links": [
                  {
                    "label": "MusicBrainz recording",
                    "url": "https://musicbrainz.org/recording/926a018b-cca9-4ba3-8b35-a8a6c69eb762"
                  },
                  {
                    "label": "MusicBrainz artist",
                    "url": "https://musicbrainz.org/artist/ba853904-ae25-4ebb-89d6-c44cfbd71bd2"
                  },
                  {
                    "label": "Last.fm",
                    "url": "https://www.last.fm/music/Blur/_/Song+2+-+2012+Remaster"
                  },
                  {
                    "label": "Wikipedia",
                    "url": "https://en.wikipedia.org/wiki/Song_2"
                  }
                ]
              },
              "sources": [
                {
                  "provider": "deadair.musicbrainz",
                  "providerRef": "926a018b-cca9-4ba3-8b35-a8a6c69eb762",
                  "fetchedAt": "2026-09-20T18:22:01.602Z",
                  "expiresAt": "2026-12-19T18:22:01.602Z",
                  "stale": false,
                  "found": true,
                  "failed": false,
                  "data": {
                    "artist": "Blur",
                    "title": "Song 2 - 2012 Remaster",
                    "album": "Blur (Rough Trade 50th Anniversary Edition)",
                    "year": 2026,
                    "genres": [
                      "alternative rock",
                      "rock",
                      "britpop",
                      "indie rock",
                      "slacker rock"
                    ],
                    "isrc": "GBAYE1200348",
                    "artworkUrl": "https://coverartarchive.org/release/c5555d72-2713-434d-a26e-584c465a5f99/11267191059-500.jpg",
                    "externalIds": [
                      {
                        "source": "musicbrainz",
                        "id": "926a018b-cca9-4ba3-8b35-a8a6c69eb762"
                      },
                      {
                        "source": "musicbrainz-artist",
                        "id": "ba853904-ae25-4ebb-89d6-c44cfbd71bd2"
                      },
                      {
                        "source": "musicbrainz-release",
                        "id": "5b75693a-f19e-401c-a320-bdedd45b6a2e"
                      },
                      {
                        "source": "musicbrainz-release-group",
                        "id": "fdd6c833-3c96-33cb-9917-72e15bcd34bc"
                      }
                    ],
                    "links": [
                      {
                        "label": "MusicBrainz recording",
                        "url": "https://musicbrainz.org/recording/926a018b-cca9-4ba3-8b35-a8a6c69eb762"
                      },
                      {
                        "label": "MusicBrainz artist",
                        "url": "https://musicbrainz.org/artist/ba853904-ae25-4ebb-89d6-c44cfbd71bd2"
                      }
                    ]
                  }
                },
                {
                  "provider": "deadair.lastfm",
                  "providerRef": "Blur\tSong 2 - 2012 Remaster",
                  "fetchedAt": "2026-09-20T18:22:01.614Z",
                  "expiresAt": "2026-12-19T18:22:01.614Z",
                  "stale": false,
                  "found": true,
                  "failed": false,
                  "data": {
                    "album": "All Out Alternative",
                    "genres": [
                      "alternative rock",
                      "Grunge",
                      "rock",
                      "britpop",
                      "indie rock"
                    ],
                    "facts": [
                      "\"Song 2\" is a song by English rock band Blur. The song is the second song on the"
                    ],
                    "externalIds": [
                      {
                        "source": "musicbrainz",
                        "id": "676c63fe-7c51-4866-92a3-4538e0f90de5"
                      }
                    ],
                    "links": [
                      {
                        "label": "Last.fm",
                        "url": "https://www.last.fm/music/Blur/_/Song+2+-+2012+Remaster"
                      }
                    ]
                  }
                },
                {
                  "provider": "deadair.wikipedia",
                  "providerRef": "Q85357",
                  "fetchedAt": "2026-09-20T18:22:01.624Z",
                  "expiresAt": "2026-12-19T18:22:01.624Z",
                  "stale": false,
                  "found": true,
                  "failed": false,
                  "data": {
                    "externalIds": [
                      {
                        "source": "wikidata",
                        "id": "Q85357"
                      }
                    ],
                    "links": [
                      {
                        "label": "Wikipedia",
                        "url": "https://en.wikipedia.org/wiki/Song_2"
                      }
                    ]
                  }
                },
                {
                  "provider": "deadair.websearch",
                  "fetchedAt": "2026-09-20T18:22:01.637Z",
                  "expiresAt": "2026-10-04T18:30:35.138Z",
                  "stale": false,
                  "found": false,
                  "failed": false,
                  "data": {}
                }
              ],
              "claims": [
                {
                  "id": "91c9a142-05d1-4172-ba3f-3d9b9c74b25c",
                  "claim": "It is the second song on their eponymous fifth studio album.",
                  "category": "summary",
                  "source": "lead",
                  "sourceProvider": "deadair.wikipedia",
                  "sourceUrl": "https://en.wikipedia.org/wiki/Song_2",
                  "sourceQuote": "It is the second song on their eponymous fifth studio album.",
                  "lastUsedAt": "2026-09-25T21:13:02.663Z"
                },
                {
                  "id": "c071d37f-4db4-4b3e-b5d2-1359fd7ddc0b",
                  "claim": "\"Song 2\" is a song by English rock band Blur.",
                  "category": "summary",
                  "source": "lead",
                  "sourceProvider": "deadair.wikipedia",
                  "sourceUrl": "https://en.wikipedia.org/wiki/Song_2",
                  "sourceQuote": "\"Song 2\" is a song by English rock band Blur.",
                  "lastUsedAt": "2026-09-25T21:13:02.663Z"
                }
              ]
            }
        """#
}
