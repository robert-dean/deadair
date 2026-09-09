using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;
using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>
/// What a player's own word means to somebody listening to this station.
///
/// The table below is the mapping, and it is a table because every row is a judgement that could
/// reasonably have gone the other way. The rule running through it: report what is true and never
/// invent a fault. The host decides what to do about a phase.
/// </summary>
public sealed class BluOsPhaseTests
{
    private static readonly Uri Mount = new("https://radio.example.com/live.mp3");

    [Theory]
    [InlineData("stop", null, PlayerPhase.Stopped)]
    [InlineData("connecting", 0, PlayerPhase.Opening)]
    [InlineData("stream", 0, PlayerPhase.Buffering)]
    [InlineData("stream", null, PlayerPhase.Buffering)]
    [InlineData("stream", 12, PlayerPhase.Playing)]
    [InlineData("play", 12, PlayerPhase.Playing)]
    public void ReadsThePlayersOwnWord(string state, int? secs, PlayerPhase expected)
    {
        Assert.Equal(expected, BluOsPhase.From(state, secs, StreamMatch.Ours).Phase);
    }

    /// <summary>
    /// Connected with nothing heard yet is warm-up rather than a fault. On an audience-gated station
    /// those seconds ARE the station: the lease, the first record, the encoder. A client that drew
    /// them as an error would be misreporting the station's ordinary behaviour.
    /// </summary>
    [Fact]
    public void ConnectedWithNothingHeardYetIsBufferingRatherThanAFault()
    {
        var status = BluOsPhase.From("stream", 0, StreamMatch.Ours);

        Assert.Equal(PlayerPhase.Buffering, status.Phase);
        Assert.NotEqual(PlayerPhase.Failed, status.Phase);
    }

    /// <summary>
    /// Somebody put a record on, or switched to another station. From this app's seat the player is
    /// gone whatever it says it is doing, and reporting anything else would draw a transport that
    /// controls nothing.
    /// </summary>
    [Theory]
    [InlineData("stream")]
    [InlineData("play")]
    [InlineData("pause")]
    public void APlayerOnSomethingElseIsStopped(string state)
    {
        var status = BluOsPhase.From(state, 40, StreamMatch.Other);

        Assert.Equal(PlayerPhase.Stopped, status.Phase);
        Assert.Contains("another source", status.Detail, StringComparison.Ordinal);
    }

    /// <summary>
    /// There is no Paused phase, and this is where its absence is felt. A paused player still holds
    /// the connection and is still an audience, so the honest report is that we are not listening.
    ///
    /// Measured on the M10: when the station's stream stopped arriving the player went to `pause`
    /// with its position frozen rather than to `stop`, so this word covers a hand on a remote and a
    /// stream that died, and nothing here can tell them apart. Stopped is right for both, and the
    /// conductor's answer to a stop nobody asked for is to try again, which is what the second case
    /// wants.
    /// </summary>
    [Fact]
    public void PausedIsStoppedBecauseThereIsNoPauseOnALiveMount()
    {
        var status = BluOsPhase.From("pause", 40, StreamMatch.Ours);

        Assert.Equal(PlayerPhase.Stopped, status.Phase);
        Assert.Contains("not playing it", status.Detail, StringComparison.Ordinal);
    }

    /// <summary>
    /// Settled by the spike on 2026-09-08, in the reassuring direction: the M10 reports the bare
    /// mount as its streamUrl after a /Play with a url, so this row is now defensive rather than the
    /// expected case. It stays because the alternative reading, that a player which did not say is
    /// not ours, would report a player that IS playing the station as stopped.
    /// </summary>
    [Fact]
    public void APlayerThatDidNotSayWhatItIsPlayingIsTakenAtItsWord()
    {
        var status = BluOsPhase.From("stream", 12, StreamMatch.Absent);

        Assert.Equal(PlayerPhase.Playing, status.Phase);
        Assert.Contains("did not say", status.Detail, StringComparison.Ordinal);
    }

    /// <summary>
    /// The spec's own list of states ends in "etc.", so a word nobody here has seen is a player
    /// doing something rather than a broken one. Calling it a failure would make a firmware update
    /// look like a fault, and the detail carries the word so somebody can go and look it up.
    /// </summary>
    [Theory]
    [InlineData("buffering")]
    [InlineData("something-in-a-later-firmware")]
    public void AWordThisPluginHasNeverSeenIsNotAFailure(string state)
    {
        var status = BluOsPhase.From(state, 0, StreamMatch.Ours);

        Assert.Equal(PlayerPhase.Opening, status.Phase);
        Assert.Contains(state, status.Detail, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void APlayerThatSaidNothingIsStillAnswering(string? state)
    {
        Assert.Equal(PlayerPhase.Opening, BluOsPhase.From(state, null, StreamMatch.Ours).Phase);
    }

    [Fact]
    public void TheWordsCaseDoesNotMatter()
    {
        Assert.Equal(PlayerPhase.Playing, BluOsPhase.From("STREAM", 12, StreamMatch.Ours).Phase);
        Assert.Equal(PlayerPhase.Stopped, BluOsPhase.From("  Stop  ", null, StreamMatch.Ours).Phase);
    }

    /// <summary>
    /// A station added by hand is filed under a service and its URL carries a prefix, which is why
    /// the mount is looked for INSIDE the value rather than compared to the whole of it.
    /// </summary>
    [Theory]
    [InlineData("https://radio.example.com/live.mp3", StreamMatch.Ours)]
    [InlineData("TuneIn:https://radio.example.com/live.mp3", StreamMatch.Ours)]
    [InlineData("Deezer:142986206", StreamMatch.Other)]
    [InlineData("https://radio.example.com/live.flac", StreamMatch.Other)]
    [InlineData("https://someone-elses-station.example.com/live.mp3", StreamMatch.Other)]
    [InlineData(null, StreamMatch.Absent)]
    [InlineData("", StreamMatch.Absent)]
    public void TellsOurStationFromWhateverElseThePlayerMightBeOn(string? streamUrl, StreamMatch expected)
    {
        Assert.Equal(expected, BluOsPhase.Match(streamUrl, Mount));
    }

    /// <summary>
    /// A different mount of the SAME station is another connection to it, and switching format is
    /// something the app does deliberately. Treating it as ours would make a format change look like
    /// nothing happened.
    /// </summary>
    [Fact]
    public void AnotherMountOfTheSameStationIsNotThisOne()
    {
        Assert.Equal(StreamMatch.Other, BluOsPhase.Match("https://radio.example.com/live.aac", Mount));
    }
}
