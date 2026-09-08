using System.Text.Json;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;
using Xunit;

namespace MaroonedSoftware.Deadair.Sdk.Tests;

/// <summary>
/// That the desk's own reading decodes, including the answer to "why is it quiet".
///
/// `PlayoutStatus` is what every transport call answers with, so the desk redraws from it rather
/// than waiting for the next poll. `silence` is the part worth a test of its own: it is ELEVEN gates
/// judged in a causal order, and the station composes the sentence. A client maps the cause to a
/// tone and draws the station's words; it never writes its own diagnosis, and it must not treat an
/// unknown-to-it remedy as absent.
/// </summary>
public class PlayoutStatusDecodeTests
{
    [Fact]
    public void DecodesAStationThatIsAiring()
    {
        const string json = """
            {
              "streamUp": true,
              "onAir": true,
              "mountPath": "/live.mp3",
              "mounts": [{ "format": "mp3", "path": "/live.mp3", "bitrateKbps": 128 }],
              "upNext": [],
              "queuedCount": 0,
              "listeners": 3,
              "audience": true,
              "staleStreamConfig": [],
              "silence": {
                "audible": true,
                "cause": "airing",
                "detail": "The station is on air.",
                "checks": []
              }
            }
            """;

        var status = JsonSerializer.Deserialize<PlayoutStatus>(json, SdkJson.Options)!;

        Assert.True(status.StreamUp);
        Assert.Equal("/live.mp3", status.MountPath);
        Assert.Equal(SilenceCause.Airing, status.Silence.Cause);
        Assert.True(status.Silence.Audible);

        // The ordinary state for both, and the one an operator should see as nothing at all rather
        // than as a panel with an empty list in it.
        Assert.Empty(status.StaleStreamConfig);
        Assert.Empty(status.Silence.Checks);
    }

    [Fact]
    public void DecodesTheGateListWhenTheStationIsQuiet()
    {
        // An audience-gated station with nobody listening. Not a fault: the gate is telling the truth,
        // and a client that drew this in a fault colour would have an operator chasing a working
        // station. `waiting` is its own state for exactly that reason.
        const string json = """
            {
              "streamUp": true,
              "onAir": false,
              "mountPath": "/live.mp3",
              "mounts": [{ "format": "mp3", "path": "/live.mp3", "bitrateKbps": 128 }],
              "upNext": [],
              "queuedCount": 12,
              "listeners": 0,
              "audience": false,
              "staleStreamConfig": [
                {
                  "container": "liquidsoap",
                  "detail": "Running config the app has since replaced.",
                  "restart": "docker compose restart liquidsoap"
                }
              ],
              "silence": {
                "audible": false,
                "cause": "noAudience",
                "detail": "Nobody is listening, and the station is set to air only when somebody is.",
                "remedy": "Tune in, or set the air mode to always.",
                "checks": [
                  { "code": "streamUnreachable", "state": "ok", "detail": "Liquidsoap is answering." },
                  { "code": "noProgramme", "state": "ok", "detail": "Twelve items are queued." },
                  {
                    "code": "noAudience",
                    "state": "waiting",
                    "detail": "No listeners for the last five minutes.",
                    "remedy": "Tune in, or set the air mode to always."
                  }
                ]
              }
            }
            """;

        var status = JsonSerializer.Deserialize<PlayoutStatus>(json, SdkJson.Options)!;

        Assert.Equal(SilenceCause.NoAudience, status.Silence.Cause);
        Assert.Equal(3, status.Silence.Checks.Count);
        Assert.Equal(SilenceState.Ok, status.Silence.Checks[0].State);
        Assert.Equal(SilenceState.Waiting, status.Silence.Checks[2].State);

        // A gate with nothing an operator can do carries no remedy, and one that does carries the
        // station's own sentence. Both have to survive the trip: the desk offers the remedy verbatim.
        Assert.Null(status.Silence.Checks[0].Remedy);
        Assert.Equal("Tune in, or set the air mode to always.", status.Silence.Checks[2].Remedy);

        // The restart is a literal command the console offers a copy button for, so it is a string to
        // pass through and not something to compose.
        var warning = Assert.Single(status.StaleStreamConfig);
        Assert.Equal(StreamConfigWarningContainer.Liquidsoap, warning.Container);
        Assert.Equal("docker compose restart liquidsoap", warning.Restart);
    }
}
