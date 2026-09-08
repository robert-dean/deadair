using MaroonedSoftware.Deadair.Desktop.Core.Playout;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// Which quiet is a fault, and which quiet is the station working.
/// </summary>
public class SilenceReadingTests
{
    [Fact]
    public void AiringIsTheTally()
    {
        Assert.Equal(StatusTone.Live, SilenceReading.ToneFor(SilenceCause.Airing));
    }

    [Theory]
    [InlineData(SilenceCause.NoAudience)]
    [InlineData(SilenceCause.WarmingUp)]
    [InlineData(SilenceCause.WaitingOnAudio)]
    [InlineData(SilenceCause.NoProgramme)]
    public void QuietOnPurposeIsNotAFault(SilenceCause cause)
    {
        // The case that matters most: an audience-gated station with nobody listening is the gate
        // doing its job. Drawing it in a fault colour sends an operator looking for a problem that is
        // a working station.
        Assert.Equal(StatusTone.Standby, SilenceReading.ToneFor(cause));
    }

    [Fact]
    public void StoodDownIsAnOperatorsOwnChoiceAndReadsAsOff()
    {
        Assert.Equal(StatusTone.Off, SilenceReading.ToneFor(SilenceCause.StoodDown));
    }

    [Theory]
    [InlineData(SilenceCause.StreamUnreachable)]
    [InlineData(SilenceCause.TransportStalled)]
    [InlineData(SilenceCause.ControlDenied)]
    [InlineData(SilenceCause.Starved)]
    [InlineData(SilenceCause.NotDriving)]
    public void SomethingBrokenReadsAsAFault(SilenceCause cause)
    {
        Assert.Equal(StatusTone.Fault, SilenceReading.ToneFor(cause));
    }

    [Fact]
    public void WaitingIsItsOwnStateRatherThanAMildFault()
    {
        Assert.Equal(StatusTone.Ok, SilenceReading.ToneFor(SilenceState.Ok));
        Assert.Equal(StatusTone.Standby, SilenceReading.ToneFor(SilenceState.Waiting));
        Assert.Equal(StatusTone.Fault, SilenceReading.ToneFor(SilenceState.Fault));
    }

    [Fact]
    public void AStationThatIsAiringHasNothingToExplain()
    {
        var airing = new StationSilence
        {
            Audible = true,
            Cause = SilenceCause.Airing,
            Detail = "The station is on air.",
            Checks = [],
        };

        var quiet = airing with { Audible = false, Cause = SilenceCause.NoAudience };

        Assert.False(SilenceReading.WorthShowing(airing));

        // Everything else is worth showing, including the states that are not faults: "why is it
        // quiet" is a question asked about a working station as often as a broken one.
        Assert.True(SilenceReading.WorthShowing(quiet));
    }
}
