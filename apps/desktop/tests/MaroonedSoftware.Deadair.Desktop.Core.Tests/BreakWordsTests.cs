using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Director;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What the desk says when the operator asks the station to say something now.
/// </summary>
/// <remarks>
/// The case worth guarding is the decline: it is a 200, so nothing in the shared failure path says
/// it, and a press the station turned down would otherwise look exactly like one it took. Neither
/// answer is a fault, so neither may be drawn in the fault colour.
/// </remarks>
public class BreakWordsTests
{
    [Theory]
    [InlineData(RequestableBreakKind.News, "The news is on its way. It goes out once it has been written.")]
    [InlineData(RequestableBreakKind.Weather, "The weather is on its way. It goes out once it has been written.")]
    [InlineData(RequestableBreakKind.Talkbreak, "The host will have a word once it has been written.")]
    public void ATakenRequestSaysWhatIsComing(RequestableBreakKind kind, string words)
    {
        var notice = BreakWords.Answer(kind, new StationBreakRequest { Accepted = true, RequestId = "r-1", SegmentId = "s-1" });

        Assert.Equal(words, Notice.Describe(notice));
        Assert.Equal(StatusTone.Ok, Notice.ToneOf(notice));
    }

    [Fact]
    public void ADeclineIsSaidWithTheStationsOwnReason()
    {
        var notice = BreakWords.Answer(
            RequestableBreakKind.News,
            new StationBreakRequest { Accepted = false, Reason = "the station has been told not to interrupt itself" });

        Assert.Equal("The station declined: the station has been told not to interrupt itself.", Notice.Describe(notice));
        Assert.Equal(StatusTone.Standby, Notice.ToneOf(notice));
    }

    [Fact]
    public void ADeclineWithNoReasonIsStillSaid()
    {
        var notice = BreakWords.Answer(RequestableBreakKind.Weather, new StationBreakRequest { Accepted = false });

        Assert.Equal("The station declined to say anything just now.", Notice.Describe(notice));
    }

    [Fact]
    public void ARefusalIsStillDrawnAsAFault()
    {
        Assert.Equal(StatusTone.Fault, Notice.ToneOf(new Notice.Failed("The station refused that.")));
        Assert.Equal(StatusTone.Fault, Notice.ToneOf(new Notice.NoLongerOperator()));
    }
}
