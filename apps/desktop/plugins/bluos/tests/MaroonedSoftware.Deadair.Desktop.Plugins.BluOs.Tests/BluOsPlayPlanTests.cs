using MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Tests;

/// <summary>
/// Whether starting means stopping first.
///
/// Measured on the M10 and in no specification: a /Play against the URL the player is already on
/// does nothing in either direction, and answers as though it worked. So a restart of our own mount
/// has to be a stop and then a play.
/// </summary>
public sealed class BluOsPlayPlanTests
{
    [Theory]
    [InlineData("stream")]
    [InlineData("play")]
    [InlineData("pause")]
    [InlineData("connecting")]
    public void APlayerAlreadyOnOurMountHasToBeStoppedFirst(string state)
    {
        Assert.True(BluOsPlayPlan.StopFirst(state, StreamMatch.Ours));
    }

    [Fact]
    public void APlayerOnOurMountButStoppedIsJustPlayed()
    {
        Assert.False(BluOsPlayPlan.StopFirst("stop", StreamMatch.Ours));
    }

    /// <summary>
    /// A /Play switches a player from another source on its own, so stopping it first would be a
    /// gap in whatever somebody else was listening to for no reason.
    /// </summary>
    [Fact]
    public void APlayerOnSomethingElseIsSwitchedOverWithoutStoppingIt()
    {
        Assert.False(BluOsPlayPlan.StopFirst("stream", StreamMatch.Other));
    }

    /// <summary>
    /// The reason this is a decision at all rather than an unconditional stop: the host re-calls
    /// PlayAsync after a poll failure too, and a player streaming perfectly well while a status
    /// request timed out should not be interrupted to prove it.
    /// </summary>
    [Fact]
    public void APlayerThatSaidNothingIsNotStoppedOnSuspicion()
    {
        Assert.False(BluOsPlayPlan.StopFirst(null, StreamMatch.Absent));
        Assert.False(BluOsPlayPlan.StopFirst("stream", StreamMatch.Absent));
    }
}
