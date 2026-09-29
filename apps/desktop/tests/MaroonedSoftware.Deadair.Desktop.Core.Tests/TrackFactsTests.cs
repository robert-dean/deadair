using System.Globalization;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// How a record's copies and its measurement read on its own page.
/// </summary>
/// <remarks>
/// The copy's states are asked in order, and the order is the rule: a benched copy may still carry
/// the error that benched it, and a copy the provider stopped serving may still have bytes. Asking
/// "does it hold bytes" first would draw a copy the station gave up on as healthy.
/// </remarks>
public class TrackFactsTests
{
    private static TrackBinding Copy() => new()
    {
        SourceId = Guid.NewGuid(),
        PluginId = "navidrome",
        ExternalId = "x",
        Playable = true,
        Origin = "playlist",
        Attempts = 0,
    };

    [Fact]
    public void ABenchedCopyIsBenchedWhateverElseItCarries()
    {
        var status = TrackFacts.Status(Copy() with { MissingAt = DateTimeOffset.UnixEpoch, ByteSize = 10, LastError = "boom" });

        Assert.Equal("Benched", status.Label);
        Assert.Equal(StatusTone.Off, status.Tone);
    }

    [Fact]
    public void ACopyTheProviderWillNotServeIsNotOffered() =>
        Assert.Equal("Not offered", TrackFacts.Status(Copy() with { Playable = false, ByteSize = 10 }).Label);

    [Fact]
    public void AFailingCopySaysHowManyTimesAndWhy()
    {
        var status = TrackFacts.Status(Copy() with { LastError = "429 Too Many Requests", Attempts = 3 });

        Assert.Equal("Failing (3)", status.Label);
        Assert.Equal(StatusTone.Fault, status.Tone);
        Assert.StartsWith("429 Too Many Requests.", status.Detail, StringComparison.Ordinal);
    }

    [Fact]
    public void AnOldErrorOnACopyThatNowHoldsBytesIsHeld() =>
        Assert.Equal("Held", TrackFacts.Status(Copy() with { LastError = "old", ByteSize = 10 }).Label);

    [Fact]
    public void ACopyPlayedAndLetGoIsDroppedNotNeverFetched() =>
        Assert.Equal("Dropped", TrackFacts.Status(Copy() with { LastServedAt = DateTimeOffset.UnixEpoch }).Label);

    [Fact]
    public void AMeasurementOfATruncatedDownloadIsNotMeasured_EvenWithADate()
    {
        var (tone, label) = TrackFacts.Measurement(new TrackAnalysis { SchemaVersion = 3, Complete = false, AnalyzedAt = DateTimeOffset.UnixEpoch });

        Assert.Equal("Incomplete", label);
        Assert.NotEqual(StatusTone.Ok, tone);
    }

    [Fact]
    public void AMomentHasBothADateAndATime_NotALoneAmPmLetter()
    {
        var at = new DateTimeOffset(2026, 9, 29, 15, 4, 0, TimeSpan.Zero);

        var said = TrackFacts.When(at, CultureInfo.GetCultureInfo("en-GB"));

        Assert.Matches(@"^\d{1,2} Sept? 2026, \d{2}:\d{2}$", said);
    }

    [Fact]
    public void NeverIsADash() => Assert.Equal("—", TrackFacts.When(null));

    [Theory]
    [InlineData(27_400_000L, "27.4 MB")]
    [InlineData(512L, "512 B")]
    [InlineData(null, "—")]
    public void ASizeReadsAsOne(long? bytes, string expected) =>
        Assert.Equal(expected, TrackFacts.Bytes(bytes, CultureInfo.InvariantCulture));

    [Fact]
    public void TheLineUnderATitleLeavesOutWhatIsNotKnown() =>
        Assert.Equal("Mother Love Bone", TrackFacts.Credit("Mother Love Bone", null, null, null));
}
