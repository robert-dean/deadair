using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Xunit;

namespace MaroonedSoftware.Deadair.Sdk.Tests;

/// <summary>
/// That the generated SDK decodes what the station actually answers.
///
/// Nothing here tests hand-written code: everything under `packages/sdk-csharp` is generated from
/// `nowplaying.types.ck`. What it does test is the pair of assumptions the whole client rests on —
/// that the generator's reading of that contract matches the API's, and that the decoder tolerates
/// what a real station sends. Compiling is one gate and decoding is a different one, which the
/// Android listener learned by having a sign-in fail on a serialization name the compiler was happy
/// with. The fixtures below are the shapes `NowPlayingService` really produces, one per branch.
/// </summary>
public class NowPlayingDecodeTests
{
    [Fact]
    public void DecodesAStationThatIsOnAir()
    {
        const string json = """
            {
              "station": "Static Between Stations",
              "onAir": true,
              "listeners": 12,
              "mounts": [
                { "format": "mp3", "path": "/live.mp3", "bitrateKbps": 128 },
                { "format": "flac", "path": "/live.flac" },
                { "format": "hls", "path": "/live.m3u8" }
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
            """;

        var now = JsonSerializer.Deserialize<NowPlaying>(json, SdkJson.Options)!;

        Assert.Equal("Static Between Stations", now.Station);
        Assert.True(now.OnAir);
        Assert.Equal(12, now.Listeners);
        Assert.Equal(NowPlayingMountFormat.Mp3, now.Mounts[0].Format);
        Assert.Equal("/live.mp3", now.Mounts[0].Path);
        Assert.Equal(128, now.Mounts[0].BitrateKbps);

        // FLAC is lossless and HLS carries the AAC variant's rate, so the station reports no rate for
        // either. Both must be absent rather than zero: a client that renders `0 kbps` in the format
        // picker is showing a number the station never said.
        Assert.Null(now.Mounts[1].BitrateKbps);
        Assert.Null(now.Mounts[2].BitrateKbps);

        // The mount carrying HLS is an arm this enum has and `PlayoutMount`'s does not.
        Assert.Equal(NowPlayingMountFormat.Hls, now.Mounts[2].Format);

        Assert.Equal("Windowlicker", now.Track!.Title);

        // `startedAt` is epoch millis and overflows a 32-bit int, which is why the contract's `int`
        // maps to `long`. A mapping to `int` fails here and nowhere else.
        Assert.Equal(1_700_000_000_000L, now.Track.StartedAt);
    }

    [Fact]
    public void DecodesAQuietStation_WhichIsAnOrdinaryAnswerAndNotAnError()
    {
        // No `track` at all, and a 200. The station still names its mounts, because a client choosing
        // how to listen has to be able to ask that of a station nobody has tuned into yet — and
        // because probing the mounts to find out instead would put an audience-gated station on air.
        const string json = """
            {"station":"Static","onAir":false,"listeners":0,"mounts":[{"format":"mp3","path":"/live.mp3","bitrateKbps":128}]}
            """;

        var now = JsonSerializer.Deserialize<NowPlaying>(json, SdkJson.Options)!;

        Assert.False(now.OnAir);
        Assert.Null(now.Track);
        Assert.Single(now.Mounts);
    }

    [Fact]
    public void DecodesATrackTheCatalogCouldSayLittleAbout()
    {
        // Every optional absent at once. A decoder without `WhenWritingNull` on these throws here.
        const string json = """
            {
              "station":"Static","onAir":true,"listeners":1,
              "mounts":[{"format":"mp3","path":"/live.mp3"}],
              "track":{"title":"Unknown","artist":"Unknown","startedAt":1700000000000}
            }
            """;

        var now = JsonSerializer.Deserialize<NowPlaying>(json, SdkJson.Options)!;

        Assert.Null(now.Track!.Album);
        Assert.Null(now.Track.ArtworkUrl);
        Assert.Null(now.Track.DurationMs);

        // Absent because the decoder could not say, which a client must draw as an unknown position
        // rather than as zero. `Playhead` refuses to extrapolate from `startedAt` for this reason.
        Assert.Null(now.Track.RemainingMs);
    }

    [Fact]
    public void KeepsAnAbsoluteArtworkUrlAndARelativeOneApart()
    {
        // Two shapes from one field: the provider's CDN until the art cache pass runs, and the
        // station's own copy afterwards. Resolving the relative form against the API root is the
        // client's job, so the SDK must hand both over untouched.
        const string absolute = """
            {"station":"S","onAir":true,"listeners":0,"mounts":[],
             "track":{"title":"t","artist":"a","startedAt":1,"artworkUrl":"https://i.example.com/cover.jpg"}}
            """;
        const string relative = """
            {"station":"S","onAir":true,"listeners":0,"mounts":[],
             "track":{"title":"t","artist":"a","startedAt":1,"artworkUrl":"art/2f6c1e9a-0000-4000-8000-000000000001"}}
            """;

        Assert.Equal(
            "https://i.example.com/cover.jpg",
            JsonSerializer.Deserialize<NowPlaying>(absolute, SdkJson.Options)!.Track!.ArtworkUrl);
        Assert.Equal(
            "art/2f6c1e9a-0000-4000-8000-000000000001",
            JsonSerializer.Deserialize<NowPlaying>(relative, SdkJson.Options)!.Track!.ArtworkUrl);
    }

    [Fact]
    public void SkipsAFieldTheStationGrewAndThisClientDoesNotKnow()
    {
        // The station is deployed from `main` and a client is not. An unknown property must be
        // skipped rather than thrown over, or every additive contract change breaks every installed
        // copy of this app at once.
        const string json = """
            {"station":"S","onAir":false,"listeners":0,"mounts":[],"somethingNewer":{"a":1}}
            """;

        var now = JsonSerializer.Deserialize<NowPlaying>(json, SdkJson.Options)!;

        Assert.Equal("S", now.Station);
    }
}
