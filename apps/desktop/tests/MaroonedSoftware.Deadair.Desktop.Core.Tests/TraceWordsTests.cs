using System.Text.Json;
using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// What the station spent, said so that a column of it can be compared at a glance.
/// </summary>
/// <remarks>
/// The question an operator brings to the Cost tab is comparative (which of these cost the most,
/// which failed), so the durations must keep their magnitude readable across four orders of it, and
/// the tree must keep a caused decision under its cause even when the cause has rotated away.
/// </remarks>
public sealed class TraceWordsTests
{
    private static readonly DateTimeOffset At = new(2026, 9, 29, 11, 0, 0, TimeSpan.Zero);

    private static TraceDecision Decision(string id, string? parent = null) => new()
    {
        Id = id,
        Kind = "director.write_break",
        Parent = parent,
        At = At,
        Ms = 1,
        Calls = 1,
        Failed = 0,
    };

    [Theory]
    [InlineData(3, "3ms")]
    [InlineData(999, "999ms")]
    [InlineData(19_243, "19.2s")]
    [InlineData(125_600, "2m 6s")]
    public void ADurationKeepsItsMagnitudeReadable(long ms, string expected)
    {
        Assert.Equal(expected, TraceWords.Spent(ms));
    }

    [Fact]
    public void ADecisionThatRecordedNoTimeIsADash_NotAMeasurement()
    {
        Assert.Equal("—", TraceWords.Cost(0));
        Assert.Equal("40ms", TraceWords.Cost(40));
    }

    [Fact]
    public void AKnownJobIsNamedAsAnOperatorWouldNameIt()
    {
        var reading = TraceWords.Describe("director.write_break");

        Assert.Equal("Wrote what a host says", reading.Sentence);
        Assert.True(reading.ShowsKind);
    }

    [Fact]
    public void ARequestAlreadyReadsAsItself_SoItsKindIsNotRepeated()
    {
        var reading = TraceWords.Describe("GET /voices");

        Assert.Equal("Request · GET /voices", reading.Sentence);
        Assert.False(reading.ShowsKind);
    }

    [Fact]
    public void AJobAddedSinceTheTableGetsASentenceFromItsOwnName_RatherThanABlank()
    {
        Assert.Equal("podcasts fetch episode", TraceWords.Describe("podcasts.fetch_episode").Sentence);
    }

    [Fact]
    public void ACausedDecisionIsDrawnUnderItsCause()
    {
        var placed = TraceWords.Forest([Decision("a"), Decision("b"), Decision("c", parent: "a"), Decision("d", parent: "c")]);

        Assert.Equal(["a:0", "c:1", "d:2", "b:0"], placed.Select(p => $"{p.Decision.Id}:{p.Depth}"));
    }

    [Fact]
    public void ADecisionWhoseCauseRotatedAwayIsARoot_RatherThanDropped()
    {
        var placed = TraceWords.Forest([Decision("orphan", parent: "gone"), Decision("b")]);

        Assert.Equal(["orphan:0", "b:0"], placed.Select(p => $"{p.Decision.Id}:{p.Depth}"));
    }

    [Fact]
    public void ACallsDetailIsDrawnAsRecorded_WithTokenCountsGrouped()
    {
        var detail = new Dictionary<string, JsonElement>
        {
            ["inputTokens"] = JsonDocument.Parse("12408").RootElement,
            ["finish"] = JsonDocument.Parse("\"stop\"").RootElement,
            ["temperature"] = JsonDocument.Parse("0.7").RootElement,
        };

        Assert.Equal("inputTokens=12,408  finish=stop  temperature=0.7", TraceWords.Detail(detail));
        Assert.Null(TraceWords.Detail(null));
    }

    [Fact]
    public void TheFooterCountsWhatIsShownAgainstWhatIsKept()
    {
        Assert.Equal("Showing 200 of 1,318 decisions, read from 1 recorded call.", TraceWords.Showing(200, 1318, 1));
    }
}
