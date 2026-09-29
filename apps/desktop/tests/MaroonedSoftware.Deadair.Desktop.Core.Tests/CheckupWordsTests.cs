using MaroonedSoftware.Deadair.Desktop.Core.Checkup;
using Xunit;

namespace MaroonedSoftware.Deadair.Desktop.Core.Tests;

/// <summary>
/// The check-up's figures, said the way the web console says them.
/// </summary>
/// <remarks>
/// An operator who reads the disk on this app and on the console must see the same number: a column
/// that disagrees with <c>du -h</c> by a unit convention is a column somebody stops trusting. And the
/// ages are the whole of what a loop reports, since the station deliberately gives no verdict.
/// </remarks>
public sealed class CheckupWordsTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 29, 11, 48, 2, TimeSpan.FromHours(1));

    [Theory]
    [InlineData(0, "just now")]
    [InlineData(9, "just now")]
    [InlineData(42, "42s ago")]
    [InlineData(150, "3m ago")]
    [InlineData(3 * 3600, "3h ago")]
    [InlineData(2 * 86_400, "2d ago")]
    public void AnAgeIsSaidInTheCoarsestUnitThatStillSaysSomething(int seconds, string expected)
    {
        Assert.Equal(expected, CheckupWords.Ago(Now, Now.AddSeconds(-seconds)));
    }

    [Fact]
    public void AMomentAheadOfThisClockIsJustNow_RatherThanANegativeAge()
    {
        Assert.Equal("just now", CheckupWords.Ago(Now, Now.AddMinutes(5)));
    }

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(1536, "2 KB")]
    [InlineData(1_572_864, "1.5 MB")]
    [InlineData(5_368_709_120, "5.0 GB")]
    public void BytesAreBinaryStepsWithOnePlaceFromAMegabyteUp(long bytes, string expected)
    {
        Assert.Equal(expected, CheckupWords.Bytes(bytes));
    }

    [Fact]
    public void ACountIsGroupedAndItsNounAgrees()
    {
        Assert.Equal("1 file", CheckupWords.Counted(1, "file", "files"));
        Assert.Equal("12,408 files", CheckupWords.Counted(12_408, "file", "files"));
    }

    [Fact]
    public void AnEmptyCatalogIsNoughtMeasured_RatherThanADivisionByZero()
    {
        Assert.Equal(0, CheckupWords.Measured(0, 0));
        Assert.Equal(50, CheckupWords.Measured(383, 766));
    }

    [Fact]
    public void TodaysLineIsATime_AndAnOlderOneCarriesItsDay()
    {
        Assert.Equal("11:40:07", CheckupWords.Moment(Now, Now.AddSeconds(-475)));
        Assert.Equal("28 Sep 23:40", CheckupWords.Moment(Now, new DateTimeOffset(2026, 9, 28, 23, 40, 0, TimeSpan.FromHours(1))));
    }

    [Fact]
    public void AMomentIsReadInTheReadersZone_NotTheStationsOne()
    {
        // 23:30 UTC on the 28th is 00:30 on the 29th an hour east, which is today for this reader.
        var utc = new DateTimeOffset(2026, 9, 28, 23, 30, 0, TimeSpan.Zero);

        Assert.Equal("00:30:00", CheckupWords.Moment(Now, utc));
    }
}
