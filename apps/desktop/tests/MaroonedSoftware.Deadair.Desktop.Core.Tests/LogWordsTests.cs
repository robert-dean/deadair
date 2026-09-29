using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using MaroonedSoftware.Deadair.Sdk.Models;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The logs the station keeps, offered and saved.
/// </summary>
/// <remarks>
/// A log that is not there is still a log somebody came looking for, so it is offered and explained
/// rather than hidden. And a saved log is attached to a bug report, where the name the station gave
/// it is the one everybody will quote.
/// </remarks>
public sealed class LogWordsTests
{
    private static LogSource Source(bool present, long bytes = 0) => new()
    {
        Id = "station",
        Label = "Station",
        Description = "What the station itself wrote.",
        Present = present,
        Levels = true,
        Bytes = bytes,
    };

    [Fact]
    public void APresentSourceIsOfferedWithItsSize()
    {
        Assert.Equal("Station (3.4 MB)", LogWords.Offered(Source(present: true, bytes: 3_565_158)));
    }

    [Fact]
    public void AnAbsentSourceIsStillOffered_AndSaysSo()
    {
        Assert.Equal("Station, nothing written yet", LogWords.Offered(Source(present: false)));
    }

    [Theory]
    [InlineData("liquidsoap", "The audio chain writes it")]
    [InlineData("shim", "The track shim writes it")]
    [InlineData("station", "The station writes it from its first line")]
    public void AnEmptyLogSaysWhatWouldFillIt(string id, string because)
    {
        Assert.Contains(because, LogWords.NothingWritten(id), StringComparison.Ordinal);
    }

    [Fact]
    public void ALinesStampIsReadInTheReadersZone()
    {
        Assert.Equal("12:04:09", LogWords.Stamp("2026-09-29T11:04:09.412Z", TimeSpan.FromHours(1)));
    }

    [Fact]
    public void ALineWithNoStampWeCanReadHasNone()
    {
        Assert.Null(LogWords.Stamp(null, TimeSpan.Zero));
        Assert.Null(LogWords.Stamp("2026/09/29 11:04:09 [clock:3]", TimeSpan.Zero));
    }

    [Theory]
    [InlineData("attachment; filename=\"deadair-api-2026-09-29.log\"", "deadair-api-2026-09-29.log")]
    [InlineData("attachment; filename=api.log", "api.log")]
    [InlineData("attachment; filename=\"../../etc/api.log\"", "api.log")]
    [InlineData(null, "deadair-station.log")]
    [InlineData("attachment", "deadair-station.log")]
    public void ADownloadKeepsTheNameTheStationGaveIt_AndNeverAPath(string? header, string expected)
    {
        Assert.Equal(expected, LogWords.DownloadName(header, "station"));
    }
}
