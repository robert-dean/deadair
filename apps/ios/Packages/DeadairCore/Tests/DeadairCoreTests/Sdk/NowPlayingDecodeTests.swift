import DeadairSdk
import Foundation
import Testing

/// That the generated SDK decodes what the station actually answers.
///
/// The models under `packages/sdk-swift` are generated from `nowplaying.types.ck`, so nothing here
/// tests hand-written code. What it tests is the pair of assumptions the whole client rests on:
/// that the generator's reading of the contract matches the API's, and that the decoder tolerates
/// what a real station sends. Compiling is one gate and decoding is another; the Kotlin SDK once
/// shipped a wire name the compiler was happy with and sign-in failed on a phone.
///
/// The fixtures are the shapes `NowPlayingService` really produces, one per branch it has, and
/// the same ones `NowPlayingDecodeTest.kt` holds.
struct NowPlayingDecodeTests {
    private func decode(_ json: String) throws -> NowPlaying {
        try SdkJSON.makeDecoder().decode(NowPlaying.self, from: Data(json.utf8))
    }

    @Test func decodesAStationThatIsOnAir() throws {
        let now = try decode(
            """
            {
              "station": "Static Between Stations",
              "onAir": true,
              "listeners": 12,
              "mounts": [
                { "format": "mp3", "path": "/live.mp3", "bitrateKbps": 128 },
                { "format": "flac", "path": "/live.flac" }
              ],
              "track": {
                "title": "Windowlicker",
                "artist": "Aphex Twin",
                "album": "Windowlicker",
                "artworkUrl": "art/2f6c1e9a-0000-4000-8000-000000000001",
                "durationMs": 366000,
                "startedAt": 1700000000000,
                "remainingMs": 120000
              }
            }
            """)

        #expect(now.station == "Static Between Stations")
        #expect(now.onAir)
        #expect(now.listeners == 12)
        #expect(now.mounts[0].format == .mp3)
        #expect(now.mounts[0].path == "/live.mp3")
        #expect(now.mounts[0].bitrateKbps == 128)
        // FLAC is lossless, so the station reports no rate for it and the field must be absent
        // rather than zero.
        #expect(now.mounts[1].bitrateKbps == nil)
        #expect(now.track?.title == "Windowlicker")
        // Epoch millis, past 32 bits. `Int` is 64-bit on every platform this app runs on.
        #expect(now.track?.startedAt == 1_700_000_000_000)
    }

    @Test func decodesAQuietStationWhichIsAnOrdinaryAnswerAndNotAnError() throws {
        // No `track` at all. The station still names its mounts, because a client choosing how to
        // listen has to be able to ask that of a station nobody has tuned into yet.
        let now = try decode(#"{"station":"Static","onAir":false,"listeners":0,"mounts":[{"format":"mp3","path":"/live.mp3","bitrateKbps":128}]}"#)

        #expect(!now.onAir)
        #expect(now.track == nil)
        #expect(now.mounts.count == 1)
    }

    @Test func decodesATrackTheCatalogCouldSayLittleAbout() throws {
        let now = try decode(#"{"station":"S","onAir":true,"listeners":1,"mounts":[],"track":{"title":"Untitled","artist":"","startedAt":42}}"#)

        #expect(now.track?.title == "Untitled")
        #expect(now.track?.album == nil)
        #expect(now.track?.artworkUrl == nil)
        #expect(now.track?.durationMs == nil)
        #expect(now.track?.remainingMs == nil)
    }

    @Test func ignoresAFieldTheStationGrewAfterThisAppShipped() throws {
        // The station and the app are versioned separately and an installed phone is not upgraded
        // when the server is, so a new field must not stop an old client reading the rest.
        #expect(try decode(#"{"station":"S","onAir":false,"listeners":0,"mounts":[],"somethingNew":{"a":1}}"#).station == "S")
    }

    @Test func readsTheHlsMountWhichThePlayoutStatusHasNoArmFor() throws {
        let now = try decode(#"{"station":"S","onAir":false,"listeners":0,"mounts":[{"format":"hls","path":"/live.m3u8"}]}"#)

        #expect(now.mounts[0].format == .hls)
        #expect(now.mounts[0].path == "/live.m3u8")
    }

    @Test func decodesABreakTheStationSpeaksOnItsOwnInsideAShowWithAHost() throws {
        // The station talking between two records: its own label as the title and no artist, which
        // is exactly the shape a client that did not read `kind` would draw as a record by nobody.
        let now = try decode(
            """
            {
              "station": "S", "onAir": true, "listeners": 1, "mounts": [],
              "show": { "name": "Late Static", "host": "Cass" },
              "track": { "kind": "break", "title": "Top of the hour", "artist": "", "durationMs": 12000, "startedAt": 42 }
            }
            """)

        #expect(now.track?.kind == .break)
        #expect(now.track?.title == "Top of the hour")
        #expect(now.track?.artist == "")
        #expect(now.show?.name == "Late Static")
        #expect(now.show?.host == "Cass")
    }

    @Test func readsAStationOlderThanKindAndShowAsPlayingARecordWithNoShowNamed() throws {
        // The field's default is the whole reason it has one. A station that predates it answers
        // without it, and the reading must not fail over that or call its records anything else.
        let now = try decode(#"{"station":"S","onAir":true,"listeners":1,"mounts":[],"track":{"title":"Windowlicker","artist":"Aphex Twin","startedAt":42}}"#)

        #expect(now.track?.kind == .record)
        #expect(now.show == nil)
    }

    @Test func decodesAShowWithNobodyNamedToPresentIt() throws {
        let now = try decode(
            #"{"station":"S","onAir":true,"listeners":1,"mounts":[],"show":{"name":"Overnight"},"track":{"kind":"record","title":"t","artist":"a","startedAt":42}}"#)

        #expect(now.show?.name == "Overnight")
        #expect(now.show?.host == nil)
    }
}
