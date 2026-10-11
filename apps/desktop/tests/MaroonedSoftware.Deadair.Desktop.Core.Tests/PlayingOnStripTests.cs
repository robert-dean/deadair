using MaroonedSoftware.Deadair.Desktop.Core.Playback;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

public sealed class PlayingOnStripTests
{
    [Fact]
    public void NamesTheSpeaker()
    {
        Assert.Equal("Playing on Kitchen", PlayingOnStrip.Caption(onDevice: true, "Kitchen", missing: false));
    }

    [Fact]
    public void SaysNothingWhileThisMacPlays()
    {
        Assert.Null(PlayingOnStrip.Caption(onDevice: false, "This Mac", missing: false));
    }

    [Fact]
    public void SaysAMissingSpeakerIsMissingAndStillNamesIt()
    {
        // Left playing, never moved: the strip reports and does nothing else.
        Assert.Equal("Playing on Kitchen, which is not on the network", PlayingOnStrip.Caption(onDevice: true, "Kitchen", missing: true));
    }

    [Fact]
    public void SaysNothingForANamelessDevice()
    {
        Assert.Null(PlayingOnStrip.Caption(onDevice: true, " ", missing: false));
    }
}
